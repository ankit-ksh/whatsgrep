import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const WIN = (env) => ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap((v) => env[v] ? [
  join(env[v], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(env[v], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(env[v], 'Chromium', 'Application', 'chrome.exe'),
  join(env[v], 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
] : []);

const MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

const LINUX_NAMES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge-stable', 'microsoft-edge', 'brave-browser'];
const LINUX_DIRS = ['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome', '/opt/microsoft/msedge'];

// First installed Chromium-based browser, or undefined. `override` (config / env) wins.
export function findBrowser({ override, platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const forced = override ?? env.WHATSGREP_BROWSER;
  if (forced) {
    if (!exists(forced)) throw new Error(`browser not found at ${forced}`);
    return forced;
  }
  const candidates = platform === 'win32' ? WIN(env)
    : platform === 'darwin' ? MAC
    : LINUX_DIRS.flatMap((d) => LINUX_NAMES.map((n) => join(d, n)));
  return candidates.find((p) => exists(p));
}

// A browser left over from an earlier run (the program was killed) keeps its profile locked, and
// every new start then fails with "browser is already running". Stop only browsers that use this
// exact profile folder, politely first. Returns how many were stopped.
export function releaseProfile(userDataDir, { platform = process.platform, run = execFileSync, kill = process.kill } = {}) {
  try {
    let pids;
    if (platform === 'win32') {
      const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--user-data-dir=' + $env:WG_DIR + '*' } | ForEach-Object { $_.ProcessId }`;
      pids = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', env: { ...process.env, WG_DIR: userDataDir } }).split(/\s+/).filter(Boolean);
    } else {
      pids = run('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).split('\n')
        .filter((l) => l.includes('--user-data-dir=' + userDataDir))
        .map((l) => l.trim().split(/\s+/)[0]);
    }
    let n = 0;
    const targets = pids.map(Number).filter((pid) => pid && pid !== process.pid);
    // Ask first: a browser stopped in the middle of a write can damage the saved WhatsApp session.
    for (const pid of targets) { try { kill(pid, platform === 'win32' ? 'SIGKILL' : 'SIGTERM'); n++; } catch {} }
    for (let i = 0; i < 20 && platform !== 'win32'; i++) {
      if (!targets.some((pid) => { try { kill(pid, 0); return true; } catch { return false; } })) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
    if (platform !== 'win32') for (const pid of targets) { try { kill(pid, 'SIGKILL'); } catch {} }
    return n;
  } catch { return 0; }
}
