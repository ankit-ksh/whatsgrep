import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NAME = 'whatsgrep-tray';
const linuxFile = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', `${NAME}.desktop`);
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

const q = (s) => `"${String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export function desktopEntry(cmd) {
  return `[Desktop Entry]
Type=Application
Name=whatsgrep tray
Comment=Status icon for the whatsgrep tracker
Exec=${cmd.map(q).join(' ')}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
}

export function isAutostart() {
  if (process.platform === 'linux') return existsSync(linuxFile());
  if (process.platform === 'win32') {
    try { execFileSync('reg', ['query', RUN_KEY, '/v', NAME], { stdio: 'ignore', windowsHide: true, timeout: 15000 }); return true; } catch { return false; }
  }
  return false;
}

// cmd: the full command that runs the tray in the foreground, e.g. [exe, '--config', ..., 'tray', 'run'].
export function setAutostart(on, cmd) {
  if (process.platform === 'linux') {
    const file = linuxFile();
    if (!on) { rmSync(file, { force: true }); return; }
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, desktopEntry(cmd));
    return;
  }
  if (process.platform === 'win32') {
    const opts = { stdio: 'ignore', windowsHide: true, timeout: 15000 };
    if (!on) { try { execFileSync('reg', ['delete', RUN_KEY, '/v', NAME, '/f'], opts); } catch {} return; }
    const line = cmd.map((a) => `"${a}"`).join(' ');
    execFileSync('reg', ['add', RUN_KEY, '/v', NAME, '/t', 'REG_SZ', '/d', `powershell.exe -NoProfile -WindowStyle Hidden -Command "& ${line.replaceAll('"', "'")}"`, '/f'], opts);
    return;
  }
  throw new Error('showing the icon at login is not supported on this system');
}
