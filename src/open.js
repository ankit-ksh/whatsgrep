import { spawn } from 'node:child_process';

// Opens a URL in the default browser. Failing is fine: the URL is printed anyway.
export function openBrowser(url, platform = process.platform) {
  const [cmd, args] = platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
  } catch {}
}
