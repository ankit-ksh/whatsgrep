import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_APP, parseConfig } from '../src/core/config.js';

test('example config parses with its sections', () => {
  const c = parseConfig(readFileSync(new URL('../config.example.yaml', import.meta.url), 'utf8'));
  assert.equal(c.app, DEFAULT_APP);
  assert.equal(c.repeatWindowMs, 0);
  assert.equal(c.rules.length, 3);
});
test('sections are optional (rules-only file)', () => {
  const c = parseConfig('rules:\n  - name: r\n    all: [hi]\n');
  assert.equal(c.rules.length, 1);
  assert.equal(c.repeatWindowMs, 0); // repeat filter is off unless asked for
});
test('app address and repeat window', () => {
  const c = parseConfig('devices: { app: "http://x:8080/app" }\nsettings: { repeat_window_hours: 0 }\nrules: []\n');
  assert.equal(c.app, 'http://x:8080/app/');
  assert.equal(c.repeatWindowMs, 0);
  assert.throws(() => parseConfig('devices: { app: "ftp://x" }\nrules: []'), /devices.app/);
});
test('invalid config throws', () => {
  assert.throws(() => parseConfig('settings: { repeat_window_hours: soon }\nrules: []'));
  assert.throws(() => parseConfig('rules:\n  - all: [hi]'));
});
test('a rule must look for something', () => {
  assert.throws(() => parseConfig('rules:\n  - name: r\n    from: all\n'), /needs something to look for/);
  assert.throws(() => parseConfig('rules:\n  - name: r\n    message: { exclude: [spam] }\n'), /needs something/);
});
test('message is optional when from picks chats', () => {
  assert.equal(parseConfig('rules:\n  - name: r\n    from: [Mess]\n').rules.length, 1);
  assert.equal(parseConfig('rules:\n  - name: r\n    message: { all: [[sale]] }\n').rules.length, 1);
});
test('notifications defaults to desktop and validates names', () => {
  assert.deepEqual(parseConfig('rules: []').methods, ['desktop']);
  assert.deepEqual(parseConfig('notifications: [desktop, devices]\nrules: []').methods, ['desktop', 'devices']);
  assert.deepEqual(parseConfig('notifications: [desktop, phone]\nrules: []').methods, ['desktop', 'devices']); // its old name still works
  assert.deepEqual(parseConfig('notifications: [desktop]\nrules: []').methods, ['desktop']);
  assert.throws(() => parseConfig('notifications: []\nrules: []'), /at least one/);
  assert.throws(() => parseConfig('notifications: [sms]\nrules: []'), /notifications must be/);
});
test('ntfy is dropped and reported, never an error', () => {
  const c = parseConfig('notifications: [desktop, ntfy]\nrules: []');
  assert.deepEqual(c.methods, ['desktop']);
  assert.deepEqual(c.dropped, ['ntfy']);
  assert.deepEqual(parseConfig('notifications: [ntfy]\nrules: []').methods, ['desktop']);
});
test('a new config starts empty, with desktop alerts and no repeat filter', async () => {
  const { defaultConfigText } = await import('../src/commands/commands.js');
  const c = parseConfig(defaultConfigText());
  assert.equal(c.rules.length, 0);
  assert.deepEqual(c.methods, ['desktop']);
  assert.equal(c.repeatWindowMs, 0);
});

test('a profile gets its own folders and keychain names, and rejects odd names', async () => {
  const { profileDirs, defaultPaths } = await import('../src/core/paths.js');
  const { useBackend, useScope, setSecret, getSecret } = await import('../src/core/secrets.js');
  const dirs = { data: '/d/whatsgrep', config: '/c/whatsgrep' };
  assert.deepEqual(profileDirs('test', dirs), { data: '/d/whatsgrep-test', config: '/c/whatsgrep-test' });
  assert.equal(defaultPaths({ profile: 'test' }, dirs).dataDir, '/d/whatsgrep-test');
  assert.throws(() => profileDirs('../x', dirs));

  const store = new Map();
  useBackend({ name: 'mem', get: (n) => store.get(n), set: (n, v) => store.set(n, v), del: (n) => store.delete(n) });
  useScope('test');
  setSecret('email:a', 'pw');
  useScope(null);
  assert.equal(getSecret('email:a'), undefined);
  assert.deepEqual([...store.keys()], ['profile:test:email:a']);
});
