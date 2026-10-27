import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMap, parse, parseDocument, stringify } from 'yaml';
import { hasMessageCondition, matchesMessage } from './matcher.js';
import { parseConfig } from './config.js';
import { manageService } from './service.js';
import { readStatus } from './status.js';
import { forgetTopic, savedTopic } from './state.js';
import { migrate } from './migrate.js';

export const COMMANDS_HELP = `Commands:
  status                              is the tracker running, matches so far
  check <text>                        test your rules against a text
  config show | path | edit | init    view, locate, edit or create the config file
  config get <key>                    e.g. config get settings.repeat_window_hours
  config set <key> <value>            e.g. config set notifications desktop,ntfy
  config unset <key>
  rules list | show <name> | remove <name>
  rules add <name> [--from a,b] [--any x,y] [--priority high]
  topic [forget]                      show (or delete) the saved ntfy topic, kept in your OS keychain
  service install|uninstall|start|stop|restart|status   run it in the background, always
  migrate [--from DIR] [--force]      copy an old ./config.yaml + ./.whatsgrep into the standard folders
  ui [--port N] [--no-open]           settings in your browser: rules, notifications, run at login
  shell                               interactive prompt with all of the above
  run                                 start the tracker in this terminal (default)
`;

// Settings read only at startup: after changing one, a running tracker must restart.
const RESTART_KEYS = ['notifications', 'ntfy'];

const listFrom = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);

// "a,b" -> [a, b]; anything else is read as YAML (true, 6, [x, y], "text").
function parseValue(raw, key) {
  if (key === 'notifications' && !/^\[/.test(raw)) return listFrom(raw);
  if (!/^[[{"']/.test(raw) && raw.includes(',')) return listFrom(raw);
  return parse(raw);
}

// A new config starts with no rules and nothing pre-filled. The Help page explains how to write them.
export const defaultConfigText = () => `# whatsgrep config. The interface edits this file for you.
# Rules are added on the Rules page; the Help page explains how to write them.

notifications: [desktop]

settings:
  repeat_window_hours: 0

rules: []
`;

function load(file) {
  if (!existsSync(file)) throw new Error(`no config at ${file}. Create one with: config init`);
  return parseDocument(readFileSync(file, 'utf8'));
}

// Refuses to save a config that would not load, so the shell can't break a running tracker.
function save(file, doc) {
  const text = doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
  parseConfig(text);
  writeFileSync(file, text);
}

const restartHint = (key) => (RESTART_KEYS.includes(key.split('.')[0]) ? '\n(restart the tracker to apply: service restart)' : '');

function editor(file) {
  const cmd = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
  spawnSync(cmd, [file], { stdio: 'inherit', shell: true });
}

function ruleSummary(r) {
  const from = r.from === undefined || r.from === 'all' ? 'all chats' : 'selected chats';
  return `${r.name}  [${r.priority ?? 'default'}]  ${from}`;
}

function configCommand(args, ctx) {
  const [sub, key, ...rest] = args;
  const file = ctx.configFile;
  switch (sub) {
    case undefined:
    case 'show': return existsSync(file) ? readFileSync(file, 'utf8').trimEnd() : `no config at ${file}`;
    case 'path': return file;
    case 'init': {
      if (existsSync(file)) return `${file} already exists`;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, defaultConfigText());
      return `Created ${file}. Edit it with: config edit`;
    }
    case 'edit': { editor(file); return ''; }
    case 'get': {
      if (!key) return configCommand(['show'], ctx);
      const v = load(file).getIn(key.split('.'));
      if (v === undefined) throw new Error(`${key} is not set`);
      return (typeof v === 'object' && v !== null ? stringify(v.toJSON?.() ?? v) : String(v)).trimEnd();
    }
    case 'set': {
      if (!key || !rest.length) throw new Error('usage: config set <key> <value>');
      const doc = load(file);
      const node = doc.createNode(parseValue(rest.join(' '), key));
      if (Array.isArray(node.items) && !isMap(node)) node.flow = true;
      doc.setIn(key.split('.'), node);
      save(file, doc);
      return `${key} updated.${restartHint(key)}`;
    }
    case 'unset': {
      if (!key) throw new Error('usage: config unset <key>');
      const doc = load(file);
      if (!doc.deleteIn(key.split('.'))) throw new Error(`${key} is not set`);
      save(file, doc);
      return `${key} removed.${restartHint(key)}`;
    }
    default: throw new Error(`unknown config command "${sub}". Try: show, path, edit, init, get, set, unset`);
  }
}

function rulesCommand(args, ctx) {
  const [sub, name, ...rest] = args;
  const file = ctx.configFile;
  const rulesOf = (doc) => doc.get('rules', true);
  const indexOf = (doc, n) => (rulesOf(doc)?.items ?? []).findIndex((r) => isMap(r) && r.get('name') === n);
  switch (sub) {
    case undefined:
    case 'list': {
      const { rules } = parseConfig(readFileSync(file, 'utf8'));
      return rules.length ? rules.map(ruleSummary).join('\n') : 'no rules';
    }
    case 'show': {
      const doc = load(file);
      const i = name ? indexOf(doc, name) : -1;
      if (i < 0) throw new Error(`no rule named "${name ?? ''}"`);
      return rulesOf(doc).items[i].toString().trimEnd();
    }
    case 'remove': {
      const doc = load(file);
      const i = name ? indexOf(doc, name) : -1;
      if (i < 0) throw new Error(`no rule named "${name ?? ''}"`);
      rulesOf(doc).items.splice(i, 1);
      save(file, doc);
      return `Removed rule "${name}". A running tracker picks this up on its own.`;
    }
    case 'add': {
      if (!name) throw new Error('usage: rules add <name> [--from a,b] [--any x,y] [--priority high]');
      const { values } = parseArgs({ args: rest, options: { from: { type: 'string' }, any: { type: 'string' }, priority: { type: 'string' } } });
      const rule = { name };
      if (values.from) rule.from = listFrom(values.from);
      if (values.any) rule.message = listFrom(values.any);
      if (values.priority) rule.priority = values.priority;
      const doc = load(file);
      if (indexOf(doc, name) >= 0) throw new Error(`a rule named "${name}" already exists`);
      if (!doc.has('rules')) doc.set('rules', doc.createNode([]));
      const node = doc.createNode(rule);
      for (const k of ['from', 'message']) if (Array.isArray(rule[k])) node.get(k, true).flow = true;
      doc.addIn(['rules'], node);
      save(file, doc);
      return `Added rule "${name}". A running tracker picks this up on its own.`;
    }
    default: throw new Error(`unknown rules command "${sub}". Try: list, show, add, remove`);
  }
}

function statusCommand(ctx) {
  const s = readStatus(ctx.dataDir);
  if (!s) return 'not running (no status recorded yet)';
  const since = Math.round((Date.now() - s.startedAt) / 60000);
  return [
    `${s.running ? 'running' : 'not running'} (pid ${s.pid}), ${s.state}`,
    `up ${since} min, ${s.matches} matches, last: ${s.lastMatch ? new Date(s.lastMatch).toLocaleString() : 'none'}`,
    `notifications: ${s.methods.join(', ') || 'none'}`,
  ].join('\n');
}

// Runs one command and returns the text to print. Shared by the CLI and the shell.
// ctx: { configFile, dataDir, serviceArgs }
export function runCommand(argv, ctx) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'config': return configCommand(args, ctx);
    case 'rules': return rulesCommand(args, ctx);
    case 'status': return statusCommand(ctx);
    case 'check': {
      const { rules } = parseConfig(readFileSync(ctx.configFile, 'utf8'));
      const hit = rules.filter((r) => hasMessageCondition(r) && matchesMessage(r, args.join(' ')));
      return hit.length ? `match: ${hit.map((r) => r.name).join(', ')}` : 'no match';
    }
    case 'service': {
      const action = args[0] ?? 'status';
      if (!['install', 'uninstall', 'start', 'stop', 'restart', 'status'].includes(action)) throw new Error(`unknown service command "${action}"`);
      return manageService(action, { args: ctx.serviceArgs, dataDir: ctx.dataDir }).trimEnd();
    }
    case 'topic': {
      if (args[0] === 'forget') { forgetTopic(); return 'Deleted the saved topic from the keychain.'; }
      const t = savedTopic(ctx.dataDir);
      return t ? `${t.topic}\n(stored in ${t.store})` : 'no topic saved yet; one is created the next time the tracker starts with ntfy enabled';
    }
    case 'migrate': {
      const { values } = parseArgs({ args, options: { from: { type: 'string' }, force: { type: 'boolean' } } });
      return migrate({ from: resolve(values.from ?? process.cwd()), config: ctx.configFile, dataDir: ctx.dataDir, force: values.force }).join('\n');
    }
    case 'help': return COMMANDS_HELP;
    default: throw new Error(`unknown command "${cmd}". Type "help".`);
  }
}
