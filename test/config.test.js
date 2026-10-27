import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../src/config.js';

test('example config parses with its sections', () => {
  const c = parseConfig(readFileSync(new URL('../config.example.yaml', import.meta.url), 'utf8'));
  assert.equal(c.server, 'https://ntfy.sh');
  assert.equal(c.repeatWindowMs, 0);
  assert.equal(c.rules.length, 3);
});
test('sections are optional (rules-only file)', () => {
  const c = parseConfig('rules:\n  - name: r\n    all: [hi]\n');
  assert.equal(c.rules.length, 1);
  assert.equal(c.repeatWindowMs, 0); // repeat filter is off unless asked for
});
test('custom server and repeat window', () => {
  const c = parseConfig('ntfy: { server: "http://x:8080" }\nsettings: { repeat_window_hours: 0 }\nrules: []\n');
  assert.equal(c.server, 'http://x:8080');
  assert.equal(c.repeatWindowMs, 0);
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
test('notifications defaults to ntfy and validates names', () => {
  assert.deepEqual(parseConfig('rules: []').methods, ['ntfy']);
  assert.deepEqual(parseConfig('notifications: [desktop]\nrules: []').methods, ['desktop']);
  assert.throws(() => parseConfig('notifications: []\nrules: []'), /at least one/);
  assert.throws(() => parseConfig('notifications: [sms]\nrules: []'), /notifications must be/);
});
test('a new config starts empty, with desktop alerts and no repeat filter', async () => {
  const { defaultConfigText } = await import('../src/commands.js');
  const c = parseConfig(defaultConfigText());
  assert.equal(c.rules.length, 0);
  assert.deepEqual(c.methods, ['desktop']);
  assert.equal(c.repeatWindowMs, 0);
});
