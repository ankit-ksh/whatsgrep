import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { isServiceInstalled, launchCommand, manageService } from './service.js';
import { readStatus } from './status.js';

export const logFile = (dataDir) => join(dataDir, 'whatsgrep.log');

// Starts the tracker: through the OS service when it is installed, otherwise as a detached
// background process that logs to the data folder.
export function startTracker({ dataDir, serviceArgs }) {
  if (readStatus(dataDir)?.running) return 'already running';
  if (isServiceInstalled()) return manageService('start', { args: serviceArgs, dataDir }).trim();
  mkdirSync(dataDir, { recursive: true });
  const log = logFile(dataDir);
  try { if (statSync(log).size > 1e6) truncateSync(log, 0); } catch {}
  const fd = openSync(log, 'a');
  const [exe, ...pre] = launchCommand();
  spawn(exe, [...pre, ...serviceArgs, 'run'], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true }).unref();
  closeSync(fd);
  return 'started';
}

export function stopTracker({ dataDir, serviceArgs }) {
  const s = readStatus(dataDir);
  if (!s?.running) return 'not running';
  if (isServiceInstalled()) return manageService('stop', { args: serviceArgs, dataDir }).trim();
  process.kill(s.pid, 'SIGTERM');
  return 'stopped';
}

export function tailLog(dataDir, lines = 200) {
  try { return readFileSync(logFile(dataDir), 'utf8').split('\n').slice(-lines).join('\n'); } catch { return ''; }
}
