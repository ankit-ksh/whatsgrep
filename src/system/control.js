import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { isServiceInstalled, launchCommand, manageService, serviceIsCurrent } from './service.js';
import { readStatus } from '../core/status.js';

export const logFile = (dataDir) => join(dataDir, 'whatsgrep.log');

// Starts the tracker: through the OS service when it is installed, otherwise as a detached
// background process that logs to the data folder.
export function startTracker({ dataDir, serviceArgs, profile }) {
  if (readStatus(dataDir)?.running) return 'already running';
  if (!profile && isServiceInstalled()) {
    // A service from an older version may still point at old folders: rewrite it for these ones.
    if (!serviceIsCurrent(serviceArgs, dataDir)) { manageService('install', { args: serviceArgs, dataDir }); return 'updated the background service and started it'; }
    return manageService('start', { args: serviceArgs, dataDir }).trim();
  }
  mkdirSync(dataDir, { recursive: true });
  const log = logFile(dataDir);
  try { if (statSync(log).size > 1e6) truncateSync(log, 0); } catch {}
  const fd = openSync(log, 'a');
  const [exe, ...pre] = launchCommand();
  const child = spawn(exe, [...pre, ...serviceArgs, 'run'], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  child.on('error', () => {}); // a failed start shows up as "stopped" with the log, not a crash
  child.unref();
  closeSync(fd);
  return 'started';
}

export function stopTracker({ dataDir, serviceArgs, profile }) {
  const s = readStatus(dataDir);
  if (!s?.running) return 'not running';
  if (!profile && isServiceInstalled()) return manageService('stop', { args: serviceArgs, dataDir }).trim();
  process.kill(s.pid, 'SIGTERM');
  return 'stopped';
}

// Stop, wait for the old process to go away, then start again.
// The wait must not block: a tracker this process started is only reaped when the event loop runs.
export async function restartTracker(opts) {
  stopTracker(opts);
  for (let i = 0; i < 100 && readStatus(opts.dataDir)?.running; i++) await new Promise((r) => setTimeout(r, 100));
  return startTracker(opts);
}

export function tailLog(dataDir, lines = 200) {
  try { return readFileSync(logFile(dataDir), 'utf8').split('\n').slice(-lines).join('\n'); } catch { return ''; }
}
