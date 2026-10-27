import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPaths } from '../src/paths.js';
import { migrate } from '../src/migrate.js';

test('default paths ignore the current directory', () => {
  const dirs = { config: '/c/whatsgrep', data: '/d/whatsgrep' };
  assert.deepEqual(defaultPaths({}, dirs), { config: '/c/whatsgrep/config.yaml', dataDir: '/d/whatsgrep' });
  assert.equal(defaultPaths({ config: '/x/my.yaml', 'data-dir': '/y' }, dirs).config, '/x/my.yaml');
});

test('migrate copies config and session, skips lock files, never touches the originals', () => {
  const root = mkdtempSync(join(tmpdir(), 'wg-mig-'));
  const from = join(root, 'old');
  mkdirSync(join(from, '.whatsgrep', 'auth', 'session'), { recursive: true });
  writeFileSync(join(from, 'config.yaml'), 'rules: []\n');
  writeFileSync(join(from, '.whatsgrep', 'auth', 'session', 'Cookies'), 'c');
  writeFileSync(join(from, '.whatsgrep', 'auth', 'session', 'SingletonLock'), 'lock');
  writeFileSync(join(from, '.whatsgrep', 'status.json'), '{}');
  const config = join(root, 'cfg', 'config.yaml');
  const dataDir = join(root, 'data');

  migrate({ from, config, dataDir });
  assert.equal(readFileSync(config, 'utf8'), 'rules: []\n');
  assert.ok(existsSync(join(dataDir, 'auth', 'session', 'Cookies')));
  assert.ok(!existsSync(join(dataDir, 'auth', 'session', 'SingletonLock')));
  assert.ok(!existsSync(join(dataDir, 'status.json')));
  assert.ok(existsSync(join(from, 'config.yaml')) && existsSync(join(from, '.whatsgrep', 'auth', 'session', 'Cookies')));

  writeFileSync(config, 'rules: [changed]\n');
  migrate({ from, config, dataDir });
  assert.equal(readFileSync(config, 'utf8'), 'rules: [changed]\n'); // existing files are kept without --force
});
