import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { isPackaged } from './sea.js';

const NAME = 'whatsgrep';

// The command that starts whatsgrep: the packaged executable itself, or node + this script.
export function launchCommand(execPath = process.execPath, script = process.argv[1], packaged = isPackaged()) {
  return packaged ? [execPath] : [execPath, script];
}

const q = (s) => `"${String(s).replaceAll('"', '\\"')}"`;

export function systemdUnit(cmd, args) {
  return `[Unit]
Description=whatsgrep: WhatsApp keyword alerts
After=network-online.target graphical-session.target
Wants=network-online.target

[Service]
ExecStart=${[...cmd, ...args].map(q).join(' ')}
Restart=always
RestartSec=15
RestartPreventExitStatus=2 3

[Install]
WantedBy=default.target
`;
}

export function launchdPlist(cmd, args, logFile) {
  const items = [...cmd, ...args].map((a) => `    <string>${a.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${NAME}</string>
  <key>ProgramArguments</key><array>
${items}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${logFile}</string>
  <key>StandardErrorPath</key><string>${logFile}</string>
</dict></plist>
`;
}

// Windows: a scheduled task at logon that restarts itself after a failure.
// DOMAIN\user for the current user, so the task is created for them alone (a task for "any user"
// needs administrator rights, or makes schtasks ask for a password).
export const windowsUser = () => (process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${userInfo().username}` : userInfo().username);

export function windowsTaskXml(cmd, args, user = windowsUser()) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const [exe, ...rest] = [...cmd, ...args];
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${esc(user)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <StartWhenAvailable>true</StartWhenAvailable>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(exe)}</Command><Arguments>${esc(rest.map(q).join(' '))}</Arguments></Exec></Actions>
</Task>
`;
}

// stdin closed and a timeout, so a tool that waits for an answer can never freeze the program.
const run = (file, args, opts) => execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000, windowsHide: true, ...opts });

const paths = (home = homedir()) => ({
  unit: join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'systemd', 'user', `${NAME}.service`),
  plist: join(home, 'Library', 'LaunchAgents', `${NAME}.plist`),
});

// Is the always-on service set up for this user?
export function isServiceInstalled(platform = process.platform) {
  if (platform === 'linux') return existsSync(paths().unit);
  if (platform === 'darwin') return existsSync(paths().plist);
  if (platform === 'win32') { try { run('schtasks', ['/Query', '/TN', NAME]); return true; } catch { return false; } }
  return false;
}

// Does the installed service launch this exact command, with these folders? A service installed by
// an older version keeps pointing at the folders it was created with.
export function serviceIsCurrent(args, dataDir, platform = process.platform) {
  const cmd = launchCommand();
  try {
    if (platform === 'linux') return readFileSync(paths().unit, 'utf8') === systemdUnit(cmd, args);
    if (platform === 'darwin') return readFileSync(paths().plist, 'utf8') === launchdPlist(cmd, args, join(dataDir, 'whatsgrep.log'));
  } catch { return false; }
  return true;
}

// install | uninstall | start | stop | restart | status. `args` are whatsgrep's own flags
// (config/data-dir) to bake in. Returns the text to show the user.
export function manageService(action, { args = [], dataDir, platform = process.platform } = {}) {
  const cmd = launchCommand();
  const home = homedir();
  if (platform === 'linux') {
    const { unit } = paths(home);
    if (action === 'install') {
      mkdirSync(dirname(unit), { recursive: true });
      writeFileSync(unit, systemdUnit(cmd, args));
      run('systemctl', ['--user', 'daemon-reload']);
      run('systemctl', ['--user', 'enable', NAME]);
      run('systemctl', ['--user', 'restart', NAME]); // restart so an already-running old copy picks up the new command
      return `Installed ${unit}\nLogs: journalctl --user -u ${NAME} -f\nTo keep it running when logged out: loginctl enable-linger $USER`;
    }
    if (action === 'uninstall') {
      try { run('systemctl', ['--user', 'disable', '--now', NAME]); } catch {}
      rmSync(unit, { force: true });
      run('systemctl', ['--user', 'daemon-reload']);
      return 'Removed the service.';
    }
    if (['start', 'stop', 'restart'].includes(action)) { run('systemctl', ['--user', action, NAME]); return `Service ${action} done.`; }
    try { return run('systemctl', ['--user', 'status', NAME, '--no-pager']); } catch (e) { return e.stdout || 'not running'; }
  }
  if (platform === 'darwin') {
    const { plist } = paths(home);
    const log = join(dataDir, 'whatsgrep.log');
    const target = `gui/${process.getuid()}`;
    if (action === 'install') {
      mkdirSync(dirname(plist), { recursive: true });
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(plist, launchdPlist(cmd, args, log));
      try { run('launchctl', ['bootout', target, plist]); } catch {}
      run('launchctl', ['bootstrap', target, plist]);
      return `Installed ${plist}\nLogs: ${log}`;
    }
    if (action === 'uninstall') {
      try { run('launchctl', ['bootout', target, plist]); } catch {}
      rmSync(plist, { force: true });
      return 'Removed the service.';
    }
    if (action === 'stop') run('launchctl', ['bootout', target, plist]);
    else if (action === 'start') run('launchctl', ['bootstrap', target, plist]);
    else if (action === 'restart') run('launchctl', ['kickstart', '-k', `${target}/${NAME}`]);
    else { try { return run('launchctl', ['print', `${target}/${NAME}`]); } catch { return 'not loaded'; } }
    return `Service ${action} done.`;
  }
  if (platform === 'win32') {
    if (action === 'install') {
      const xml = join(dataDir, 'task.xml');
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(xml, '\ufeff' + windowsTaskXml(cmd, args), 'utf16le');
      try { run('schtasks', ['/End', '/TN', NAME]); } catch {}
      run('schtasks', ['/Create', '/F', '/TN', NAME, '/XML', xml]);
      run('schtasks', ['/Run', '/TN', NAME]);
      return 'Installed. It starts at every logon and restarts if it stops.';
    }
    if (action === 'uninstall') {
      try { run('schtasks', ['/End', '/TN', NAME]); } catch {}
      run('schtasks', ['/Delete', '/F', '/TN', NAME]);
      return 'Removed the task.';
    }
    if (action === 'start') run('schtasks', ['/Run', '/TN', NAME]);
    else if (action === 'stop') run('schtasks', ['/End', '/TN', NAME]);
    else if (action === 'restart') { try { run('schtasks', ['/End', '/TN', NAME]); } catch {} run('schtasks', ['/Run', '/TN', NAME]); }
    else { try { return run('schtasks', ['/Query', '/TN', NAME, '/V', '/FO', 'LIST']); } catch { return 'not installed'; } }
    return `Service ${action} done.`;
  }
  throw new Error(`services are not supported on ${platform}`);
}
