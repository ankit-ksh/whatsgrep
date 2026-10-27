import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
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
export function windowsTaskXml(cmd, args) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const [exe, ...rest] = [...cmd, ...args];
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions><Exec><Command>${esc(exe)}</Command><Arguments>${esc(rest.map(q).join(' '))}</Arguments></Exec></Actions>
</Task>
`;
}

const run = (file, args, opts) => execFileSync(file, args, { stdio: 'pipe', encoding: 'utf8', ...opts });

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
      run('systemctl', ['--user', 'enable', '--now', NAME]);
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
