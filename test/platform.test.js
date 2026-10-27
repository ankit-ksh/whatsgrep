import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDirs } from '../src/paths.js';
import { findBrowser } from '../src/browser.js';
import { launchdPlist, systemdUnit, windowsTaskXml } from '../src/service.js';
import { backendFor } from '../src/secrets.js';
import { tokenize } from '../src/shell.js';

test('per-user folders follow each OS convention', () => {
  assert.deepEqual(appDirs('linux', {}, '/h'), { data: '/h/.local/share/whatsgrep', config: '/h/.config/whatsgrep' });
  assert.equal(appDirs('linux', { XDG_CONFIG_HOME: '/x' }, '/h').config, '/x/whatsgrep');
  assert.equal(appDirs('darwin', {}, '/Users/a').data, '/Users/a/Library/Application Support/whatsgrep');
  assert.match(appDirs('win32', { APPDATA: 'C:\\R', LOCALAPPDATA: 'C:\\L' }, 'C:\\h').config, /whatsgrep$/);
});

test('findBrowser: override wins, then first installed candidate', () => {
  assert.equal(findBrowser({ override: '/b', exists: (p) => p === '/b' }), '/b');
  assert.throws(() => findBrowser({ override: '/nope', exists: () => false }), /not found/);
  assert.equal(findBrowser({ platform: 'linux', env: {}, exists: (p) => p === '/usr/bin/chromium' }), '/usr/bin/chromium');
  assert.equal(findBrowser({ platform: 'darwin', env: {}, exists: (p) => p.includes('Google Chrome') }), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(findBrowser({ platform: 'linux', env: {}, exists: () => false }), undefined);
});

test('service definitions carry the command and restart policy', () => {
  const cmd = ['/bin/whatsgrep'];
  const args = ['--config', '/c d/config.yaml'];
  assert.match(systemdUnit(cmd, args), /ExecStart="\/bin\/whatsgrep" "--config" "\/c d\/config.yaml"/);
  assert.match(systemdUnit(cmd, args), /Restart=always/);
  assert.match(launchdPlist(cmd, args, '/log'), /<key>KeepAlive<\/key><true\/>/);
  assert.match(windowsTaskXml(['C:\\w\\whatsgrep.exe'], args), /<Command>C:\\w\\whatsgrep.exe<\/Command>/);
  assert.match(windowsTaskXml(cmd, args), /RestartOnFailure/);
  const xml = windowsTaskXml(cmd, args, 'PC\\me');
  assert.match(xml, /<LogonTrigger>[^]*<UserId>PC\\me<\/UserId>/);   // per-user trigger: no admin rights or password needed
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
});

test('secrets backends call the native tools without leaking values into scripts', () => {
  const calls = [];
  const run = (file, a, opts) => { calls.push({ file, a, opts }); return 'val\n'; };
  const linux = backendFor('linux', run);
  linux.set('topic', 's3cret');
  assert.equal(calls[0].file, 'secret-tool');
  assert.equal(calls[0].opts.input, 's3cret');
  assert.ok(!calls[0].a.includes('s3cret'));
  assert.equal(linux.get('topic'), 'val');
  assert.equal(backendFor('darwin', run).get('topic'), 'val');
  const win = backendFor('win32', run);
  win.set('topic', 's3cret');
  const last = calls.at(-1);
  assert.equal(last.opts.env.WG_VALUE, 's3cret');
  assert.ok(!last.a.join(' ').includes('s3cret'));
});

test('shell input is split like a shell line', () => {
  assert.deepEqual(tokenize('rules add "my rule" --any "a b"'), ['rules', 'add', 'my rule', '--any', 'a b']);
  assert.deepEqual(tokenize('config set notifications desktop,ntfy'), ['config', 'set', 'notifications', 'desktop,ntfy']);
  assert.deepEqual(tokenize('rules remove "my rule"'), ['rules', 'remove', 'my rule']);
});

test('an installed service is current only when it matches the folders in use', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { serviceIsCurrent, launchCommand } = await import('../src/service.js');
  const dir = mkdtempSync(join(tmpdir(), 'wg-svc-'));
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    const args = ['--config', '/new/config.yaml', '--data-dir', '/new/data', '--resume'];
    mkdirSync(join(dir, 'systemd', 'user'), { recursive: true });
    writeFileSync(join(dir, 'systemd', 'user', 'whatsgrep.service'), systemdUnit(launchCommand(), ['--config', '/old/config.yaml', '--data-dir', '/old/.whatsgrep']));
    assert.equal(serviceIsCurrent(args, '/new/data', 'linux'), false);
    writeFileSync(join(dir, 'systemd', 'user', 'whatsgrep.service'), systemdUnit(launchCommand(), args));
    assert.equal(serviceIsCurrent(args, '/new/data', 'linux'), true);
  } finally { if (old === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = old; }
});
