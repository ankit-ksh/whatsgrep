import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImapFlow } from 'imapflow';
import { attachmentsOf, parseMail } from './parse.js';

const MAX_SOURCE = 256 * 1024;     // bytes of each message that are read
const CATCH_UP_MAX_AGE = 24 * 3600e3; // after downtime, only mail from the last day is alerted
const CATCH_UP_MAX = 200;
const BACKOFF = [3000, 10000, 30000, 60000, 300000];

const stateFile = (dataDir) => join(dataDir, 'email-state.json');
function loadState(dataDir) {
  try { return JSON.parse(readFileSync(stateFile(dataDir), 'utf8')); } catch { return {}; }
}
function saveState(dataDir, state) {
  try {
    mkdirSync(dataDir, { recursive: true });
    const tmp = stateFile(dataDir) + '.tmp';
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, stateFile(dataDir));
  } catch {}
}

const clientFor = (account, password) => new ImapFlow({
  host: account.host,
  port: account.port,
  secure: account.secure,
  auth: { user: account.user, pass: password },
  logger: false,
  autoIdleDelay: 250,      // start listening almost at once; the library's default waits 15 s, which is when mail would be missed
  maxIdleTime: 5 * 60e3,   // restart IDLE now and then so a silently dead connection is noticed
});

const friendly = (e) => {
  if (e?.authenticationFailed) return 'Login failed. Check the address and the app password.';
  if (e?.code === 'ENOTFOUND') return `Cannot find the server ${e.hostname ?? ''}. Check the server name.`;
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT') return `Cannot reach the server (${e.code}).`;
  if (/wrong version number|packet length too long|ssl routines/i.test(String(e?.message))) return 'The server does not use encryption on this port. Check the port (993 is usual).';
  return e?.responseText || e?.message || String(e);
};

// Connects once, opens the folder and disconnects. For the "Test connection" button and command.
export async function testAccount(account, password) {
  const client = clientFor(account, password);
  client.on('error', () => {});
  try {
    await client.connect();
    const box = await client.mailboxOpen(account.folder, { readOnly: true });
    return { ok: true, messages: box.exists };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  } finally {
    try { await client.logout(); } catch { try { client.close(); } catch {} }
  }
}

// The folders of an account, for the picker. One short, read-only connection, like testAccount.
export async function listFolders(account, password) {
  const client = clientFor(account, password);
  client.on('error', () => {});
  try {
    await client.connect();
    const boxes = await client.list();
    return {
      ok: true,
      folders: boxes
        .filter((b) => !b.flags?.has('\\Noselect') && !b.flags?.has('\\NonExistent'))
        .map((b) => ({ path: b.path, name: b.name, special: b.specialUse ?? null }))
        .sort((a, b) => (a.path === 'INBOX' ? -1 : b.path === 'INBOX' ? 1 : a.path.localeCompare(b.path))),
    };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  } finally {
    try { await client.logout(); } catch { try { client.close(); } catch {} }
  }
}

// Keeps one mailbox open with IMAP IDLE: the server tells us the moment mail arrives, so alerts
// are near instant. Reconnects by itself. It only reads (the folder is opened read-only), so mail
// is never marked as read, moved or deleted.
// onMail(mail) is called once per new message; onStatus({ state, error }) reports the connection.
export function watchAccount(account, password, { dataDir, onMail, onStatus, log = console }) {
  let stopped = false;
  let client;
  let attempt = 0;
  let chain = Promise.resolve();
  let timer;

  const setStatus = (state, error) => onStatus?.({ state, error });

  async function readNew(box, state) {
    const key = account.stateKey ?? account.name;
    const since = state[key].lastUid;
    const mails = [];
    for await (const msg of client.fetch(`${since + 1}:*`, { uid: true, flags: true, internalDate: true, size: true, bodyStructure: true, source: { maxLength: MAX_SOURCE } }, { uid: true })) {
      if (msg.uid <= since) continue; // "N:*" always includes the last message
      mails.push(msg);
    }
    mails.sort((a, b) => a.uid - b.uid);
    for (const msg of mails.slice(-CATCH_UP_MAX)) {
      state[key].lastUid = Math.max(state[key].lastUid, msg.uid);
      if (msg.flags?.has('\\Seen') || msg.flags?.has('\\Deleted') || msg.flags?.has('\\Draft')) continue;
      if (Date.now() - new Date(msg.internalDate).getTime() > CATCH_UP_MAX_AGE) continue;
      try {
        const mail = await parseMail(msg.source);
        mail.uid = msg.uid;
        mail.size = msg.size ?? 0;
        mail.attachments = attachmentsOf(msg.bodyStructure);
        mail.folder = account.folder;
        mail.account = account.name;
        await onMail(mail);
      } catch (e) {
        log.error?.(`[${account.name}] could not read a message: ${e.message}`);
      }
    }
    if (mails.length) state[key].lastUid = Math.max(state[key].lastUid, mails[mails.length - 1].uid);
    saveState(dataDir, state);
  }

  async function connect() {
    if (stopped) return;
    setStatus('connecting');
    client = clientFor(account, password);
    client.on('error', (e) => log.warn?.(`[${account.name}] ${friendly(e)}`));
    try {
      await client.connect();
      const box = await client.mailboxOpen(account.folder, { readOnly: true });
      const state = loadState(dataDir);
      const stateKey = account.stateKey ?? account.name;
      const saved = state[stateKey];
      if (!saved || saved.uidValidity !== String(box.uidValidity)) {
        state[stateKey] = { uidValidity: String(box.uidValidity), lastUid: box.uidNext - 1 }; // first run: only mail from now on
      }
      client.on('exists', () => {
        chain = chain.then(() => readNew(box, state)).catch((e) => log.error?.(`[${account.name}] ${friendly(e)}`));
      });
      client.on('close', () => {
        if (stopped) return;
        setStatus('connecting', 'Connection lost, reconnecting');
        schedule();
      });
      await readNew(box, state); // anything that arrived while we were away
      attempt = 0;
      setStatus('connected');
    } catch (e) {
      try { client.close(); } catch {}
      if (e?.authenticationFailed) { setStatus('error', friendly(e)); return; } // retrying would only get the account locked
      setStatus('error', friendly(e));
      schedule();
    }
  }

  function schedule() {
    if (stopped || timer) return;
    const wait = BACKOFF[Math.min(attempt++, BACKOFF.length - 1)];
    timer = setTimeout(() => { timer = undefined; connect(); }, wait);
    timer.unref?.();
  }

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      try { client?.logout().catch(() => client.close()); } catch {}
    },
  };
}

// The latest messages of a folder, read-only, for "which of my recent mail would this rule match?".
export async function previewMail(account, password, limit = 50) {
  const client = clientFor(account, password);
  client.on('error', () => {});
  const out = [];
  try {
    await client.connect();
    const box = await client.mailboxOpen(account.folder, { readOnly: true });
    if (!box.exists) return out;
    const from = Math.max(1, box.exists - limit + 1);
    for await (const msg of client.fetch(`${from}:*`, { uid: true, size: true, bodyStructure: true, source: { maxLength: MAX_SOURCE } })) {
      const mail = await parseMail(msg.source);
      mail.size = msg.size ?? 0;
      mail.attachments = attachmentsOf(msg.bodyStructure);
      out.push(mail);
    }
    return out.reverse();
  } finally {
    try { await client.logout(); } catch { try { client.close(); } catch {} }
  }
}
