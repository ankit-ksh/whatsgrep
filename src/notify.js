import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const METHODS = ['desktop', 'ntfy'];

// JSON publish keeps non-ASCII titles/messages (emoji, Hindi, ...) intact.
async function ntfy({ server, topic, title, message, priority, tags }) {
  const res = await fetch(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority: priorityNum(priority), tags }),
  });
  if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
}

const LEVELS = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };
const priorityNum = (p) => LEVELS[p] ?? 3;

// Native notification: notify-send (Linux), osascript (macOS), a PowerShell toast (Windows).
// Title/message are passed as arguments or env vars, never spliced into script text.
const URGENCY = { min: 'low', low: 'low', urgent: 'critical' };
const WIN_TOAST = `
$t = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$x = $t::GetTemplateContent('ToastText02')
$n = $x.GetElementsByTagName('text')
$n.Item(0).AppendChild($x.CreateTextNode($env:WG_TITLE)) | Out-Null
$n.Item(1).AppendChild($x.CreateTextNode($env:WG_BODY)) | Out-Null
$t::CreateToastNotifier('whatsgrep').Show([Windows.UI.Notifications.ToastNotification]::new($x))
`;
async function desktop({ title, message, priority }) {
  switch (process.platform) {
    case 'linux':
      return void await run('notify-send', ['-a', 'whatsgrep', '-u', URGENCY[priority] ?? 'normal', '--', title, message]);
    case 'darwin':
      return void await run('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, message]);
    case 'win32':
      return void await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_TOAST], { env: { ...process.env, WG_TITLE: title, WG_BODY: message } });
    default:
      throw new Error(`desktop notifications are not supported on ${process.platform}`);
  }
}

const SENDERS = { ntfy, desktop };

// Sends through every enabled method; one failing doesn't stop the others.
export async function notify(methods, payload) {
  const results = await Promise.allSettled(methods.map((m) => SENDERS[m](payload)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[${payload.rule}] ${methods[i]} notification failed: ${r.reason.message}`);
  });
  return results.map((r, i) => ({ method: methods[i], ok: r.status === 'fulfilled', error: r.status === 'rejected' ? r.reason.message : undefined }));
}
