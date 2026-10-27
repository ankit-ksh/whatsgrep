#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, statSync, watchFile } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { hasMessageCondition, matches, matchesMessage } from './matcher.js';
import { parseConfig } from './config.js';
import { resolveTopic } from './state.js';
import { notify } from './notify.js';
import { findBrowser } from './browser.js';
import { defaultPaths, legacyFiles } from './paths.js';
import { COMMANDS_HELP, runCommand } from './commands.js';
import { runShell } from './shell.js';
import { appendMatch, clearAccount, readStatus, sendCommand, takeCommand, trimMatches, writeAccount, writeChats, writeStatus } from './status.js';
import { startServer } from './server.js';
import { openBrowser } from './open.js';
import { isPackaged } from './sea.js';
import { VERSION } from './version.js';

const HELP = `whatsgrep - get notified when WhatsApp messages match your rules

Usage: whatsgrep [options]            start the tracker
       whatsgrep <command> [...]      manage it (see Commands below)

  -c, --config <file>   rules file (default: config.yaml in the per-user config folder)
  -t, --topic <value>   use this ntfy topic (default: a new random topic every run)
  -r, --resume          reuse the ntfy topic from the last run instead of a new one
  -s, --server <url>    ntfy server (default: ntfy.server in config, else https://ntfy.sh)
  -d, --data-dir <dir>  session + state folder (default: the per-user data folder)
  -b, --browser <path>  Chrome/Chromium/Edge to use (default: auto-detected; or set WHATSGREP_BROWSER)
      --qr              print a QR code to subscribe on your phone (shown
                        automatically unless --resume)
      --verbose         print every incoming message with its chat name and id
      --dry-run         print matches, don't send notifications
      --check <text>    test rules against a text offline and exit
                        (also: whatsgrep check <text>)
  -v, --version         print the version
  -h, --help

${COMMANDS_HELP}`;

const OPTIONS = {
  config: { type: 'string', short: 'c' },
  browser: { type: 'string', short: 'b' },
  topic: { type: 'string', short: 't' },
  resume: { type: 'boolean', short: 'r' },
  server: { type: 'string', short: 's' },
  'data-dir': { type: 'string', short: 'd' },
  'dry-run': { type: 'boolean' },
  qr: { type: 'boolean' },
  verbose: { type: 'boolean' },
  check: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

// Flags come before the command; everything after the command word belongs to the command
// (so `rules add x --any a,b` keeps its own flags).
const argv = process.argv.slice(2);
const cmdAt = parseArgs({ args: argv, options: OPTIONS, strict: false, allowPositionals: true, tokens: true })
  .tokens.find((t) => t.kind === 'positional')?.index ?? argv.length;
let opt;
try {
  opt = parseArgs({ args: argv.slice(0, cmdAt), options: OPTIONS }).values;
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(1);
}
const positionals = argv.slice(cmdAt);

if (opt.version) { console.log(`whatsgrep ${VERSION}`); process.exit(0); }
if (opt.help) { console.log(HELP); process.exit(0); }

const { config: configFile, dataDir } = defaultPaths(opt);
opt.config = configFile;
opt['data-dir'] = dataDir;

// Flags to bake into a background service so it uses the same files as this invocation.
// --resume: a background tracker keeps the topic you subscribed to instead of making a new one each start.
const serviceArgs = ['--config', configFile, '--data-dir', dataDir, '--resume', ...(opt.browser ? ['--browser', opt.browser] : [])];
const ctx = { configFile, dataDir, serviceArgs };

// Older versions kept their files in whatever folder they were started from.
const old = legacyFiles();
if ((old.config && !existsSync(configFile)) || (old.data && !existsSync(join(dataDir, 'auth')))) {
  if (!positionals.length || ['run', 'ui', 'shell'].includes(positionals[0])) {
    console.warn(`Found files from an older version in ${process.cwd()}. whatsgrep now keeps its files in:\n  config: ${configFile}\n  data:   ${dataDir}\nRun \`whatsgrep migrate\` here to copy them over (the originals stay).\n`);
  }
}

const [command] = positionals;
if (opt.check !== undefined) positionals.splice(0, positionals.length, 'check', opt.check);
if (command === 'shell') { await runShell(ctx); process.exit(0); }
if (command === 'ui') {
  const { values } = parseArgs({ args: positionals.slice(1), options: { port: { type: 'string' }, 'no-open': { type: 'boolean' } } });
  const { url } = await startServer(ctx, { port: Number(values.port ?? 0) });
  console.log(`whatsgrep UI: ${url}\nPress Ctrl+C to close it (the tracker keeps running).`);
  if (!values['no-open']) openBrowser(url);
  await new Promise(() => {});
}
if (positionals.length && command !== 'run') {
  try {
    const out = runCommand(positionals, ctx);
    if (out) console.log(out);
    process.exit(0);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

const loadConfig = () => parseConfig(readFileSync(opt.config, 'utf8'));
let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`Could not load ${opt.config}: ${e.message}\nCreate one with: whatsgrep config init`);
  process.exit(1);
}
let { rules } = config;
const server = opt.server ?? config.server;

// Pick up config edits as soon as the file is saved; keep the old rules if the new file is broken.
let rulesMtime = statSync(opt.config).mtimeMs;
function reloadRulesIfChanged() {
  try {
    const m = statSync(opt.config).mtimeMs;
    if (m === rulesMtime) return;
    rulesMtime = m;
    config = loadConfig();
    ({ rules } = config);
    if (config.methods.join() !== methods.join()) console.warn('notifications changed in the config; restart whatsgrep to apply');
    console.log(`Reloaded ${opt.config} (${rules.length} rules)`);
  } catch (e) {
    console.warn(`Config reload failed, keeping previous rules: ${e.message}`);
  }
}

watchFile(opt.config, { interval: 500 }, reloadRulesIfChanged);

trimMatches(opt['data-dir']);

// One tracker per data folder: two would fight over the same WhatsApp session.
const running = readStatus(opt['data-dir']);
if (running?.running && running.pid !== process.pid) {
  console.error(`whatsgrep is already running (pid ${running.pid}). Stop it first, or use the UI / \`whatsgrep service\`.`);
  process.exit(3);
}

// Methods are fixed at startup (ntfy needs its topic set up first); edits need a restart.
const methods = config.methods;
const useNtfy = methods.includes('ntfy');
const { topic, source, store } = useNtfy ? resolveTopic(opt['data-dir'], opt.topic, opt.resume) : {};
const dryRun = opt['dry-run'];
console.log(`Notifications: ${methods.join(', ') || 'none'}`);
if (useNtfy) console.log(`ntfy topic (${source}), stored in ${store}:\n  ${topic}\nSubscribe to it in the ntfy app/web: ${server}/${topic}\n`);

const { default: wweb } = await import('whatsapp-web.js');
const { default: qrcode } = await import('qrcode-terminal');

// ntfy:// deep link opens the app and offers to subscribe (no typing the topic).
if (useNtfy && (opt.qr || !opt.resume || opt.topic)) {
  const u = new URL(server);
  const deepLink = `ntfy://${u.host}/${topic}${u.protocol === 'http:' ? '?secure=false' : ''}`;
  console.log('Scan with your phone camera to subscribe in the ntfy app:');
  qrcode.generate(deepLink, { small: true });
  console.log(`(${deepLink})\n`);
}
const { Client, LocalAuth } = wweb;

// Prefer the real browser installed on this machine. Without one, a packaged build can't run;
// from source, puppeteer falls back to the Chromium it downloaded.
let browserPath;
try {
  browserPath = findBrowser({ override: opt.browser ?? config.browser });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
if (!browserPath && isPackaged()) {
  console.error('No Chrome, Chromium, Edge or Brave found. Install one, or point to it with --browser <path> (or WHATSGREP_BROWSER).');
  process.exit(1);
}
if (browserPath) console.log(`Browser: ${browserPath}`);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: join(opt['data-dir'], 'auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox'], executablePath: browserPath },
});

// Live state for the `status` command. Exit codes: 1 = lost connection (a service restarts it),
// 2 = needs a human (re-link), which a service must not retry in a loop.
const stats = { pid: process.pid, startedAt: Date.now(), state: 'starting', matches: 0, lastMatch: null, recent: [], methods };
const publish = (state) => { if (state) stats.state = state; writeStatus(opt['data-dir'], stats); };
const die = (code, msg) => { console.error(msg); publish(code === 2 ? 'needs login' : 'disconnected'); process.exit(code); };
publish();

// WhatsApp rotates the login QR every ~20s until it is scanned. Redraw it in place
// instead of stacking a new copy under the old one.
let qrLines = 0;
let qrCount = 0;
client.on('qr', (qr) => {
  // Under a service nobody can scan: stop instead of asking WhatsApp for logins forever.
  if (!process.stdout.isTTY && ++qrCount > 3) die(2, 'Not linked to WhatsApp. Run `whatsgrep` once in a terminal, scan the QR, then start the service.');
  stats.qr = qr;
  publish('waiting for QR scan');
  qrcode.generate(qr, { small: true }, (art) => {
    const block = `Scan this QR with WhatsApp > Linked devices (it refreshes every ~20s):\n${art}`;
    if (qrLines && process.stdout.isTTY) process.stdout.write(`\x1b[${qrLines}A\x1b[0J`);
    console.log(block);
    qrLines = block.split('\n').length;
  });
});
client.on('authenticated', () => { qrLines = 0; delete stats.qr; publish('linking'); });
client.on('auth_failure', (m) => die(2, `WhatsApp login failed: ${m}. Run whatsgrep in a terminal to link again.`));
client.on('disconnected', (reason) => {
  if (String(reason).toUpperCase() === 'LOGOUT') { clearAccount(opt['data-dir']); die(2, 'WhatsApp was logged out (from the phone). Link again to continue.'); }
  die(1, `Disconnected from WhatsApp (${reason}).`);
});
// chat id -> { name, phone }. wwebjs's getChat()/getChats() throw "r: r" on some WhatsApp
// Web versions, so read from WhatsApp's in-page collections directly. Newer WhatsApp uses
// anonymous "@lid" ids for chats; resolve those to the real phone number when known.
const chatInfo = new Map();
let warnedChat = false;
async function chatInfoOf(id) {
  if (chatInfo.has(id)) return chatInfo.get(id);
  try {
    const info = await client.pupPage.evaluate((cid) => {
      const wid = window.require('WAWebWidFactory').createWid(cid);
      const chat = window.require('WAWebCollections').Chat.get(wid);
      let phone = '';
      try {
        const p = wid.server === 'lid' ? window.require('WAWebApiContact').getPhoneNumber(wid) : wid;
        phone = p?.user ?? '';
      } catch {}
      return { name: chat ? (chat.formattedTitle || chat.name || '') : '', phone };
    }, id);
    if (info.name || info.phone) chatInfo.set(id, info);
    return info;
  } catch (e) {
    if (!warnedChat) { warnedChat = true; console.warn(`could not read chat info (${e.message}); chats can still be matched by id, see --verbose`); }
    return { name: '', phone: '' };
  }
}

// Commands from the UI: re-check the connection, or log out.
setInterval(async () => {
  const cmd = takeCommand(opt['data-dir']);
  if (!cmd) return;
  if (cmd.action === 'check') {
    try { stats.waState = await client.getState(); } catch (e) { stats.waState = `ERROR ${e.message}`; }
    stats.checkedAt = Date.now();
    publish();
  } else if (cmd.action === 'chats') {
    try {
      const chats = await client.pupPage.evaluate(() => {
        const col = window.require('WAWebCollections').Chat;
        const models = col.getModelsArray ? col.getModelsArray() : col.models;
        return models.slice(0, 1500).map((c) => {
          let phone = '';
          try {
            const wid = c.id;
            const p = wid.server === 'lid' ? window.require('WAWebApiContact').getPhoneNumber(wid) : wid;
            if (!c.isGroup) phone = p?.user ?? '';
          } catch {}
          return { id: c.id._serialized, name: c.formattedTitle || c.name || '', group: !!c.isGroup, phone, t: c.t || 0 };
        });
      });
      writeChats(opt['data-dir'], chats.sort((a, b) => b.t - a.t));
    } catch (e) { console.warn(`could not read the chat list: ${e.message}`); }
  } else if (cmd.action === 'logout') {
    try { await client.logout(); } catch (e) { console.warn(`logout: ${e.message}`); }
    await client.destroy().catch(() => {});
    rmSync(join(opt['data-dir'], 'auth'), { recursive: true, force: true });
    clearAccount(opt['data-dir']);
    delete stats.account;
    die(2, 'Logged out of WhatsApp.');
  }
}, 1000);

client.on('ready', () => {
  stats.account = { number: client.info?.wid?.user ?? '', name: client.info?.pushname ?? '' };
  stats.waState = 'CONNECTED';
  stats.checkedAt = Date.now();
  writeAccount(opt['data-dir'], stats.account);
  // Refresh the chat list for the UI's picker shortly after connecting.
  setTimeout(() => { try { sendCommand(opt['data-dir'], 'chats'); } catch {} }, 8000);
  delete stats.qr;
  publish('listening');
  client.pupBrowser?.on('disconnected', () => die(1, 'The browser closed unexpectedly.'));
  console.log(`Listening${dryRun ? ' (dry run)' : ''}... Ctrl+C to stop.`);
});

// Same sender repeating the same text shouldn't ping again.
const seen = new Map();
const isRepeat = (key) => {
  if (!config.repeatWindowMs) return false; // off: every match alerts
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > config.repeatWindowMs) seen.delete(k);
  const dup = seen.has(key);
  seen.set(key, now);
  return dup;
};

// message_create also fires for messages you send, which 'message' skips.
client.on('message_create', async (msg) => {
  try {
    // Own messages are ignored, except in your "Message yourself" chat (handy for testing).
    if ((msg.fromMe && msg.to !== msg.from) || msg.isStatus || !msg.body) return;
    reloadRulesIfChanged();
    const chatId = msg.fromMe ? msg.to : msg.from;
    const { name: chatName, phone } = await chatInfoOf(chatId);
    const chatKeys = [chatName, chatId, phone && `${phone}@c.us`];
    if (opt.verbose) {
      const lag = Math.round(Date.now() / 1000 - msg.timestamp);
      console.log(`  [${chatName || '?'} | ${chatId}${phone ? ` | +${phone}` : ''}] (${lag}s after sent) ${msg.body}`);
    }
    for (const rule of rules) {
      if (!matches(rule, msg.body, chatKeys)) continue;
      if (isRepeat(`${rule.name}|${msg.author ?? msg.from}|${msg.body}`)) continue;
      console.log(`[${rule.name}] ${chatName}: ${msg.body}`);
      stats.matches++;
      stats.lastMatch = Date.now();
      stats.recent = [{ t: stats.lastMatch, rule: rule.name, chat: chatName || 'chat', text: msg.body.slice(0, 140) }, ...stats.recent].slice(0, 8);
      publish();
      const rec = { t: stats.lastMatch, rule: rule.name, chat: chatName || 'chat', text: msg.body.slice(0, 2000), priority: rule.priority ?? 'default', sent: [], failed: [] };
      if (dryRun) { rec.dry = true; appendMatch(opt['data-dir'], rec); continue; }
      try {
        for (const r of await notify(methods, { rule: rule.name, server, topic, title: `${rule.name} · ${chatName || 'chat'}`, message: msg.body, priority: rule.priority })) {
          if (r.ok) rec.sent.push(r.method); else rec.failed.push({ method: r.method, error: r.error });
        }
      } catch (e) {
        console.error(`[${rule.name}] notification failed: ${e.message}`);
        rec.failed.push({ method: 'all', error: e.message });
      }
      appendMatch(opt['data-dir'], rec);
    }
  } catch (e) {
    console.error('message handling failed:', e.message);
  }
});

const stop = async () => { publish('stopped'); await client.destroy().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await client.initialize();
