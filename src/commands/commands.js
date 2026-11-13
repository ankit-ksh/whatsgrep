import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMap, parse, parseDocument, stringify } from 'yaml';
import { hasMessageCondition, matchesMessage } from '../core/rule.js';
import { parseConfig } from '../core/config.js';
import { manageService } from '../system/service.js';
import { restartTracker, startTracker, stopTracker } from '../system/control.js';
import { trackerCommand } from './trackers.js';
import { devicesCommand } from './devices.js';
import { trayCommand } from '../tray/index.js';
import { readStatus } from '../core/status.js';
import { forgetEmailPassword } from '../trackers/email/password.js';
import { migrate } from '../system/migrate.js';

export const COMMANDS_HELP = `Commands:
  status                              is the tracker running, matches so far
  start | stop | restart              control the tracker (uses the background service when installed)
  tray [enable|disable|stop|status]   menu-bar / system-tray icon with start, stop and open interface
  check <text>                        test your rules against a text
  config show | path | edit | init    view, locate, edit or create the config file
  config get <key>                    e.g. config get settings.repeat_window_hours
  config set <key> <value>            e.g. config set notifications desktop,devices
  config unset <key>
  rules list | show <name> | remove <name>
  rules add <name> [--on all|Tracker,...] [--from a,b] [--any x,y] [--priority high]
  tracker list | add | remove | enable | disable | password | test | link
                                      what to watch: WhatsApp accounts and mailboxes
  devices [list|pair|add <code>|remove <id>|test [<id>]|name [<text>]]
                                      phones, tablets and laptops that get alerts, encrypted end to end
  reset                               (with --profile) delete that profile's files and keychain entries
  service install|uninstall|start|stop|restart|status   run it in the background, always
  migrate [--from DIR] [--force]      copy an old ./config.yaml + ./.whatsgrep into the standard folders
  ui [--port N] [--no-open]           settings in your browser: rules, notifications, run at login
  shell                               interactive prompt with all of the above
  run                                 start the tracker in this terminal (default)
`;

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
      return `${key} updated.`;
    }
    case 'unset': {
      if (!key) throw new Error('usage: config unset <key>');
      const doc = load(file);
      if (!doc.deleteIn(key.split('.'))) throw new Error(`${key} is not set`);
      save(file, doc);
      return `${key} removed.`;
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
      const { values } = parseArgs({ args: rest, options: { from: { type: 'string' }, any: { type: 'string' }, priority: { type: 'string' }, on: { type: 'string' } } });
      const rule = { name };
      if (values.on) rule.on = values.on.toLowerCase() === 'all' ? 'all' : listFrom(values.on);
      if (values.from) rule.from = listFrom(values.from);
      if (values.any) rule.message = listFrom(values.any);
      if (values.priority) rule.priority = values.priority;
      const doc = load(file);
      if (indexOf(doc, name) >= 0) throw new Error(`a rule named "${name}" already exists`);
      if (!doc.has('rules')) doc.set('rules', doc.createNode([]));
      const node = doc.createNode(rule);
      for (const k of ['from', 'message', 'on']) if (Array.isArray(rule[k])) node.get(k, true).flow = true;
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
  const trackers = (s.trackers ?? []).map((t) => `  ${t.name}: ${t.state}${t.error ? ` (${t.error})` : ''}`);
  return [
    `${s.running ? 'running' : 'not running'} (pid ${s.pid}), ${s.state}`,
    ...trackers,
    `up ${since} min, ${s.matches} matches, last: ${s.lastMatch ? new Date(s.lastMatch).toLocaleString() : 'none'}`,
    `notifications: ${s.methods.join(', ') || 'none'}`,
  ].join('\n');
}

// Runs one command and returns the text to print. Shared by the CLI and the shell.
// A profile is for trying things out, so it never installs anything on the system.
function noProfile(ctx, what) {
  if (ctx.profile) throw new Error(`${what} is not available in a profile (it is a separate test copy: use start, stop and ui)`);
}

// Delete a profile completely: its tracker, files and keychain entries.
function resetProfile(ctx) {
  if (!ctx.profile) throw new Error('reset only works with --profile <name>, so it can never delete your real setup');
  let ids = [];
  try { ids = parseConfig(readFileSync(ctx.configFile, 'utf8')).trackers.map((t) => t.id); } catch {}
  stopTracker(ctx);
  for (const id of ids) forgetEmailPassword(id);
  for (const dir of [ctx.dataDir, dirname(ctx.configFile)]) rmSync(dir, { recursive: true, force: true });
  return `Deleted profile "${ctx.profile}".`;
}

// ctx: { configFile, dataDir, serviceArgs, profile }
export async function runCommand(argv, ctx) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'config': return configCommand(args, ctx);
    case 'rules': return rulesCommand(args, ctx);
    case 'status': return statusCommand(ctx);
    case 'tracker': return trackerCommand(args, ctx);
    case 'start': return startTracker(ctx);
    case 'stop': return stopTracker(ctx);
    case 'restart': return restartTracker(ctx);
    case 'tray': return noProfile(ctx, 'tray') ?? trayCommand(args, ctx);
    case 'check': {
      const { rules } = parseConfig(readFileSync(ctx.configFile, 'utf8'));
      const hit = rules.filter((r) => hasMessageCondition(r) && matchesMessage(r, args.join(' ')));
      return hit.length ? `match: ${hit.map((r) => r.name).join(', ')}` : 'no match';
    }
    case 'service': {
      noProfile(ctx, 'service');
      const action = args[0] ?? 'status';
      if (!['install', 'uninstall', 'start', 'stop', 'restart', 'status'].includes(action)) throw new Error(`unknown service command "${action}"`);
      return manageService(action, { args: ctx.serviceArgs, dataDir: ctx.dataDir }).trimEnd();
    }
    case 'reset': return resetProfile(ctx);
    case 'devices': case 'phone': return devicesCommand(args, ctx);
    case 'migrate': {
      const { values } = parseArgs({ args, options: { from: { type: 'string' }, force: { type: 'boolean' } } });
      return migrate({ from: resolve(values.from ?? process.cwd()), config: ctx.configFile, dataDir: ctx.dataDir, force: values.force }).join('\n');
    }
    case 'help': return COMMANDS_HELP;
    default: throw new Error(`unknown command "${cmd}". Type "help".`);
  }
}
