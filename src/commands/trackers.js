import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { isMap, parseDocument } from 'yaml';
import { parseConfig, slug } from '../core/config.js';
import { readStatus, sendCommand } from '../core/status.js';
import { forgetEmailPassword, hasEmailPassword, saveEmailPassword } from '../trackers/email/password.js';
import { PROVIDERS, providerFor } from '../trackers/email/providers.js';
import { testAccount } from '../trackers/email/watch.js';
import { emailPassword } from '../trackers/email/password.js';

const FMT = { flowCollectionPadding: false, lineWidth: 0 };

function load(file) {
  if (!existsSync(file)) throw new Error(`no config at ${file}. Create one with: config init`);
  return parseDocument(readFileSync(file, 'utf8'));
}

function save(file, doc) {
  const text = doc.toString(FMT);
  parseConfig(text); // refuses a file that would not load
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

// A config written before trackers existed has the one WhatsApp account implied. Adding a tracker
// writes it down so the list is complete.
function trackersOf(doc) {
  if (!doc.has('trackers')) {
    const seq = doc.createNode([{ name: 'WhatsApp', type: 'whatsapp' }]);
    seq.items[0].flow = true;
    doc.set('trackers', seq);
  }
  return doc.get('trackers', true);
}

const indexOf = (seq, name) => seq.items.findIndex((t) => isMap(t) && String(t.get('name')).toLowerCase() === String(name).toLowerCase());

// Reads a password without showing it: from a pipe, or typed at a prompt.
async function askSecret(ctx, label) {
  if (ctx.askSecret) return ctx.askSecret(label);
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.split(/\r?\n/)[0];
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.startsWith(label)) process.stdout.write(s); };
    rl.question(label, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

function summary(t, st) {
  const live = st?.running ? st.trackers?.find((x) => x.id === t.id) : undefined;
  const state = !t.enabled ? 'off' : live ? live.state : 'not running';
  const detail = t.type === 'email' ? `${t.user}${hasEmailPassword(t) ? '' : '  (no password saved)'}` : (live?.account?.number ? `+${live.account.number}` : '');
  return [t.name, t.type, state, detail].join('  ').trimEnd();
}

export async function trackerCommand(args, ctx) {
  const [sub, ...rest] = args;
  const file = ctx.configFile;
  switch (sub) {
    case undefined:
    case 'list': {
      const { trackers } = parseConfig(readFileSync(file, 'utf8'));
      const st = readStatus(ctx.dataDir);
      return trackers.map((t) => summary(t, st)).join('\n');
    }
    case 'add': {
      const [type, name, ...flags] = rest;
      if (!['whatsapp', 'email'].includes(type) || !name) throw new Error('usage: tracker add whatsapp <name>\n       tracker add email <name> --user <address> [--provider gmail|outlook|yahoo|icloud|fastmail|other] [--host h] [--port n] [--folder INBOX]');
      const { values } = parseArgs({ args: flags, options: { user: { type: 'string' }, provider: { type: 'string' }, host: { type: 'string' }, port: { type: 'string' }, folder: { type: 'string', multiple: true } } });
      const doc = load(file);
      const seq = trackersOf(doc);
      if (indexOf(seq, name) >= 0) throw new Error(`a tracker named "${name}" already exists`);
      const def = { id: slug(name), name, type };
      if (type === 'email') {
        if (!values.user) throw new Error('an email tracker needs --user <address>');
        def.user = values.user;
        def.provider = values.provider ?? providerFor(values.user);
        if (!PROVIDERS[def.provider]) throw new Error(`unknown provider "${def.provider}"`);
        if (values.host) def.host = values.host;
        if (values.port) def.port = Number(values.port);
        if (values.folder?.length) def.folders = values.folder;
        if (!def.host && !PROVIDERS[def.provider].host) throw new Error('this provider needs --host <imap server>');
      }
      const node = doc.createNode(def);
      node.flow = true;
      seq.items.push(node);
      save(file, doc);
      if (type === 'whatsapp') return `Added "${name}". Link it by running whatsgrep in a terminal (it shows a QR code), or from the interface.`;
      const tracker = parseConfig(readFileSync(file, 'utf8')).trackers.find((t) => t.name === name);
      const pw = await askSecret(ctx, `Password for ${values.user} (${PROVIDERS[def.provider].help}): `);
      if (!pw) return `Added "${name}" without a password. Set it with: tracker password "${name}"`;
      if (!saveEmailPassword(tracker, pw)) return `Added "${name}", but there is no OS keychain to keep the password in. Set the environment variable WHATSGREP_EMAIL_PASSWORD_${tracker.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')} for the tracker instead.`;
      return `Added "${name}" and saved its password in your OS keychain. A running tracker starts it on its own.`;
    }
    case 'remove': {
      const [name] = rest;
      const doc = load(file);
      const seq = trackersOf(doc);
      const i = name ? indexOf(seq, name) : -1;
      if (i < 0) throw new Error(`no tracker named "${name ?? ''}"`);
      const id = String(seq.items[i].get('id') ?? slug(name));
      seq.items.splice(i, 1);
      save(file, doc);
      forgetEmailPassword(id);
      return `Removed "${name}" and its saved password. Rules that listened only to it now match nothing.`;
    }
    case 'enable':
    case 'disable': {
      const [name] = rest;
      const doc = load(file);
      const seq = trackersOf(doc);
      const i = name ? indexOf(seq, name) : -1;
      if (i < 0) throw new Error(`no tracker named "${name ?? ''}"`);
      if (sub === 'enable') seq.items[i].delete('enabled'); else seq.items[i].set('enabled', false);
      save(file, doc);
      return `${sub === 'enable' ? 'Turned on' : 'Turned off'} "${name}".`;
    }
    case 'password': {
      const [name] = rest;
      const t = parseConfig(readFileSync(file, 'utf8')).trackers.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
      if (!t || t.type !== 'email') throw new Error(`no email tracker named "${name ?? ''}"`);
      const pw = await askSecret(ctx, `Password for ${t.user}: `);
      if (!pw) throw new Error('no password given');
      if (!saveEmailPassword(t, pw)) throw new Error('could not save to the OS keychain');
      return 'Password saved in your OS keychain. Restart the tracker to use it: restart';
    }
    case 'test': {
      const [name] = rest;
      const t = parseConfig(readFileSync(file, 'utf8')).trackers.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
      if (!t || t.type !== 'email') throw new Error(`no email tracker named "${name ?? ''}"`);
      const pw = emailPassword(t);
      if (!pw) throw new Error('no password saved for this tracker');
      const r = await testAccount({ ...t, folder: t.folders[0] }, pw);
      return r.ok ? `Connected to ${t.host}. ${t.folders[0]} has ${r.messages} messages.` : `Could not connect: ${r.error}`;
    }
    case 'link': {
      const [name] = rest;
      const t = parseConfig(readFileSync(file, 'utf8')).trackers.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
      if (!t || t.type !== 'whatsapp') throw new Error(`no WhatsApp tracker named "${name ?? ''}"`);
      if (!readStatus(ctx.dataDir)?.running) return 'The tracker is not running. Start it in a terminal with: whatsgrep run   (it shows a QR code to scan)';
      sendCommand(ctx.dataDir, 'login', { tracker: t.id });
      return 'Asked the tracker to show a QR code. Open the interface to scan it.';
    }
    default: throw new Error(`unknown tracker command "${sub}". Try: list, add, remove, enable, disable, password, test, link`);
  }
}
