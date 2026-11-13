import { spawn } from 'node:child_process';
import { launchCommand } from '../system/service.js';
import { openBrowser } from '../core/open.js';
import { startServer } from '../server/server.js';
import { readStatus } from '../core/status.js';
import { isAutostart, setAutostart } from './autostart.js';
import { clearTrayPid, trayPid, trayRunCommand, writeTrayPid } from './index.js';
import { buildView } from './model.js';

async function backend() {
  if (process.platform === 'linux') return (await import('./linux.js')).createTray;
  if (process.platform === 'win32') return (await import('./windows.js')).createTray;
  throw new Error('the tray icon works on Linux and Windows. On macOS use "whatsgrep ui" or the commands start, stop and status.');
}

// Runs until quit. The tracker is a separate process (or service), so closing the icon never stops tracking.
export async function runTray(ctx) {
  const existing = trayPid(ctx.dataDir);
  if (existing && existing !== process.pid) { console.log(`The icon is already showing (pid ${existing}).`); return; }
  const createTray = await backend();
  writeTrayPid(ctx.dataDir);

  let pending, autostart = isAutostart(), shown = '', server;
  const tray = await createTray({ onClick: (id) => act(id) });
  const refresh = () => {
    const view = buildView(readStatus(ctx.dataDir), { pending, autostart });
    const key = JSON.stringify(view);
    if (key !== shown) { shown = key; tray.update(view); }
  };

  // Start, stop and restart run the same commands you would type, as a separate process.
  const cli = (verb) => {
    const [exe, ...rest] = [...launchCommand(), ...ctx.serviceArgs.filter((a) => a !== '--resume'), verb];
    spawn(exe, rest, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  };
  const act = async (id) => {
    if (id === 'start' || id === 'restart') { pending = { wantRunning: true, until: Date.now() + 30000 }; cli(id); }
    else if (id === 'stop') { pending = { wantRunning: false, until: Date.now() + 15000 }; cli('stop'); }
    else if (id === 'ui') {
      try { server ??= await startServer(ctx, { port: 0 }); openBrowser(server.url); } catch (e) { console.error(`could not open the interface: ${e.message}`); }
    } else if (id === 'autostart') {
      try { setAutostart(!autostart, trayRunCommand(ctx)); autostart = !autostart; } catch (e) { console.error(e.message); }
    } else if (id === 'quit') quit();
    refresh();
  };

  const timer = setInterval(refresh, 2000);
  const quit = () => { clearInterval(timer); tray.close(); clearTrayPid(ctx.dataDir); process.exit(0); };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, quit);
  refresh();
  console.log(`whatsgrep tray icon running (pid ${process.pid}).`);
  await new Promise(() => {});
}
