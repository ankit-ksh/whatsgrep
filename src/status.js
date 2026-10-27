import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
