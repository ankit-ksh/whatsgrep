import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The running tracker records its state here so `status` (from any terminal or the shell) can show it.
const fileOf = (dataDir) => join(dataDir, 'status.json');

export function writeStatus(dataDir, status) {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(fileOf(dataDir), JSON.stringify(status), { mode: 0o600 });
  } catch {}
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function readStatus(dataDir) {
  try {
    const s = JSON.parse(readFileSync(fileOf(dataDir), 'utf8'));
    return { ...s, running: alive(s.pid) };
  } catch {
    return undefined;
  }
}

// The linked WhatsApp account, kept after the tracker stops so the UI can still show who is linked.
const accountFile = (dataDir) => join(dataDir, 'account.json');
export function writeAccount(dataDir, account) {
  try { mkdirSync(dataDir, { recursive: true }); writeFileSync(accountFile(dataDir), JSON.stringify(account), { mode: 0o600 }); } catch {}
}
export function readAccount(dataDir) {
  try { return JSON.parse(readFileSync(accountFile(dataDir), 'utf8')); } catch { return undefined; }
}
export const clearAccount = (dataDir) => rmSync(accountFile(dataDir), { force: true });

// One-way inbox: the UI drops a command, the running tracker picks it up within a second.
const commandFile = (dataDir) => join(dataDir, 'command.json');
export function sendCommand(dataDir, action) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(commandFile(dataDir), JSON.stringify({ action, at: Date.now() }), { mode: 0o600 });
}
export function takeCommand(dataDir) {
  try {
    const c = JSON.parse(readFileSync(commandFile(dataDir), 'utf8'));
    rmSync(commandFile(dataDir), { force: true });
    return c;
  } catch { return undefined; }
}

// Chat list exported by the tracker so the UI can offer a picker (also usable while it is stopped).
const chatsFile = (dataDir) => join(dataDir, 'chats.json');
export function writeChats(dataDir, chats) {
  try { mkdirSync(dataDir, { recursive: true }); writeFileSync(chatsFile(dataDir), JSON.stringify({ at: Date.now(), chats }), { mode: 0o600 }); } catch {}
}
export function readChats(dataDir) {
  try { return JSON.parse(readFileSync(chatsFile(dataDir), 'utf8')); } catch { return { at: 0, chats: [] }; }
}

// History of every match (one JSON object per line), newest last on disk, newest first when read.
const MAX_KEPT = 3000;
const matchesFile = (dataDir) => join(dataDir, 'matches.jsonl');
export function appendMatch(dataDir, rec) {
  try { mkdirSync(dataDir, { recursive: true }); appendFileSync(matchesFile(dataDir), JSON.stringify(rec) + '\n', { mode: 0o600 }); } catch {}
}
// Called when the tracker starts, so the file cannot grow forever.
export function trimMatches(dataDir, keep = MAX_KEPT) {
  try {
    const lines = readFileSync(matchesFile(dataDir), 'utf8').split('\n').filter(Boolean);
    if (lines.length > keep) writeFileSync(matchesFile(dataDir), lines.slice(-keep).join('\n') + '\n', { mode: 0o600 });
  } catch {}
}
let cache = { file: '', mtime: 0, rows: [] };
export function readMatches(dataDir, limit = Infinity) {
  const file = matchesFile(dataDir);
  try {
    const m = statSync(file).mtimeMs;
    if (cache.file !== file || cache.mtime !== m) {
      const rows = [];
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        try { rows.push(JSON.parse(line)); } catch {}
      }
      cache = { file, mtime: m, rows: rows.reverse() };
    }
    return cache.rows.slice(0, limit);
  } catch { return []; }
}
export const clearMatches = (dataDir) => { rmSync(matchesFile(dataDir), { force: true }); cache = { file: '', mtime: 0, rows: [] }; };
