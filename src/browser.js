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
