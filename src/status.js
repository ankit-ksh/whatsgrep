import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
