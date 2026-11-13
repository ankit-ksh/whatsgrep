import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchCommand } from '../system/service.js';
import { isAutostart, setAutostart } from './autostart.js';

const pidFile = (dataDir) => join(dataDir, 'tray.pid');
const SUPPORTED = ['linux', 'win32'];

export function trayPid(dataDir) {
  try {
    const pid = Number(readFileSync(pidFile(dataDir), 'utf8'));
    process.kill(pid, 0);
    return pid;
  } catch { return undefined; }
}
export const writeTrayPid = (dataDir) => { mkdirSync(dataDir, { recursive: true }); writeFileSync(pidFile(dataDir), String(process.pid)); };
export const clearTrayPid = (dataDir) => rmSync(pidFile(dataDir), { force: true });

// The foreground command, with the same folders as this invocation.
export const trayRunCommand = (ctx) => [...launchCommand(), ...ctx.serviceArgs.filter((a) => a !== '--resume'), 'tray', 'run'];

const HELP = `tray            show the icon (in the background)
tray enable     show the icon at every login
tray disable    stop showing it at login
tray stop       remove the icon now
tray status     is it showing, and is it set for login
tray run        show it in this terminal (what login uses)`;

// `tray run` is handled by the CLI itself (it never returns); everything else is quick.
export function trayCommand(args, ctx) {
  const sub = args[0] ?? 'start';
  if (!['start', 'enable', 'disable', 'stop', 'status'].includes(sub)) throw new Error(`unknown tray command "${sub}"\n${HELP}`);
  if (!SUPPORTED.includes(process.platform)) throw new Error('the tray icon works on Linux and Windows. On macOS use "whatsgrep ui" or the commands start, stop and status.');
  const pid = trayPid(ctx.dataDir);
  switch (sub) {
    case 'start': {
      if (pid) return `already showing (pid ${pid})`;
      mkdirSync(ctx.dataDir, { recursive: true });
      const fd = openSync(join(ctx.dataDir, 'tray.log'), 'w');
      const [exe, ...rest] = trayRunCommand(ctx);
      const child = spawn(exe, rest, { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
      child.on('error', () => {});
      child.unref();
      closeSync(fd);
      return 'tray icon started';
    }
    case 'stop': {
      if (!pid) return 'not showing';
      process.kill(pid, 'SIGTERM');
      return 'tray icon removed';
    }
    case 'enable': setAutostart(true, trayRunCommand(ctx)); return 'the icon will show at every login' + (pid ? '' : ' (run "tray" to show it now)');
    case 'disable': setAutostart(false); return 'the icon will no longer show at login';
    case 'status': return `${pid ? `showing (pid ${pid})` : 'not showing'}; at login: ${isAutostart() ? 'yes' : 'no'}`;
  }
}
