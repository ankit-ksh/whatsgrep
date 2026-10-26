#!/usr/bin/env node
import { readFileSync, statSync, watchFile } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { hasMessageCondition, matches, matchesMessage } from './matcher.js';
import { parseConfig } from './config.js';
import { resolveTopic } from './state.js';
import { notify } from './notify.js';

const HELP = `whatsgrep - get notified when WhatsApp messages match your rules

Usage: whatsgrep [options]

  -c, --config <file>   rules file (default: config.yaml)
  -t, --topic <value>   ntfy topic to use and save; "random" generates a new one
  -s, --server <url>    ntfy server (default: ntfy.server in config, else https://ntfy.sh)
  -d, --data-dir <dir>  session + state folder (default: .whatsgrep)
      --qr              print a QR code to subscribe on your phone (shown
                        automatically when the topic is new)
      --verbose         print every incoming message with its chat name and id
      --dry-run         print matches, don't send notifications
      --check <text>    test rules against a text offline and exit
                        (also: whatsgrep check <text>)
  -h, --help
`;

let parsed;
try {
  parsed = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c', default: 'config.yaml' },
    topic: { type: 'string', short: 't' },
    server: { type: 'string', short: 's' },
    'data-dir': { type: 'string', short: 'd', default: '.whatsgrep' },
    'dry-run': { type: 'boolean' },
    qr: { type: 'boolean' },
    verbose: { type: 'boolean' },
    check: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  });
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(1);
}
const { values: opt, positionals } = parsed;

// `whatsgrep check "some text"` is shorthand for --check
if (positionals[0] === 'check') opt.check = positionals.slice(1).join(' ');
else if (positionals.length) {
  console.error(`Unknown command: ${positionals[0]}\n\n${HELP}`);
  process.exit(1);
}

if (opt.help) { console.log(HELP); process.exit(0); }

const loadConfig = () => parseConfig(readFileSync(opt.config, 'utf8'));
let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`Could not load ${opt.config}: ${e.message}\nCopy config.example.yaml to config.yaml first.`);
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

if (opt.check !== undefined) {
  const hit = rules.filter((r) => hasMessageCondition(r) && matchesMessage(r, opt.check));
  console.log(hit.length ? `match: ${hit.map((r) => r.name).join(', ')}` : 'no match');
  process.exit(0);
}

watchFile(opt.config, { interval: 500 }, reloadRulesIfChanged);

// Methods are fixed at startup (ntfy needs its topic set up first); edits need a restart.
const methods = config.methods;
const useNtfy = methods.includes('ntfy');
const { topic, source } = useNtfy ? resolveTopic(opt['data-dir'], opt.topic) : {};
const dryRun = opt['dry-run'];
console.log(`Notifications: ${methods.join(', ') || 'none'}`);
if (useNtfy) console.log(`ntfy topic (${source}):\n  ${topic}\nSubscribe to it in the ntfy app/web: ${server}/${topic}\n`);

const { default: wweb } = await import('whatsapp-web.js');
const { default: qrcode } = await import('qrcode-terminal');

// ntfy:// deep link opens the app and offers to subscribe (no typing the topic).
if (useNtfy && (opt.qr || source !== 'saved')) {
  const u = new URL(server);
  const deepLink = `ntfy://${u.host}/${topic}${u.protocol === 'http:' ? '?secure=false' : ''}`;
  console.log('Scan with your phone camera to subscribe in the ntfy app:');
  qrcode.generate(deepLink, { small: true });
  console.log(`(${deepLink})\n`);
}
const { Client, LocalAuth } = wweb;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: join(opt['data-dir'], 'auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox'] },
});

// WhatsApp rotates the login QR every ~20s until it is scanned. Redraw it in place
// instead of stacking a new copy under the old one.
let qrLines = 0;
client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true }, (art) => {
    const block = `Scan this QR with WhatsApp > Linked devices (it refreshes every ~20s):\n${art}`;
    if (qrLines && process.stdout.isTTY) process.stdout.write(`\x1b[${qrLines}A\x1b[0J`);
    console.log(block);
    qrLines = block.split('\n').length;
  });
});
client.on('authenticated', () => { qrLines = 0; });
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

client.on('ready', () => console.log(`Listening${dryRun ? ' (dry run)' : ''}... Ctrl+C to stop.`));

// Same sender repeating the same text shouldn't ping again.
const seen = new Map();
const isRepeat = (key) => {
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
      if (dryRun) continue;
      try {
        await notify(methods, { rule: rule.name, server, topic, title: `${rule.name} · ${chatName || 'chat'}`, message: msg.body, priority: rule.priority });
      } catch (e) {
        console.error(`[${rule.name}] notification failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.error('message handling failed:', e.message);
  }
});

process.on('SIGINT', async () => { await client.destroy().catch(() => {}); process.exit(0); });
await client.initialize();
