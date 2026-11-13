import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../src/tray/model.js';
import { dotPixmap } from '../src/tray/icon.js';
import { desktopEntry } from '../src/tray/autostart.js';

const ids = (v) => v.items.filter((i) => i.id).map((i) => i.id);

test('stopped tracker offers Start only', () => {
  const v = buildView(undefined);
  assert.equal(v.tone, 'off');
  assert.deepEqual(ids(v), ['status', 'start', 'ui', 'autostart', 'quit']);
});

test('listening tracker offers Stop and Restart, and shows matches', () => {
  const v = buildView({ running: true, state: 'listening', matches: 3 });
  assert.equal(v.tone, 'ok');
  assert.match(v.tooltip, /Listening · 3 matches/);
  assert.deepEqual(ids(v), ['status', 'stop', 'restart', 'ui', 'autostart', 'quit']);
});

test('a pending Start shows Starting until it is listening or times out', () => {
  const now = 1000;
  const pending = { wantRunning: true, until: now + 5000 };
  assert.equal(buildView({ running: false }, { pending, now }).tone, 'busy');
  assert.equal(buildView({ running: true, state: 'listening', matches: 0 }, { pending, now }).tone, 'ok');
  assert.equal(buildView({ running: false }, { pending, now: now + 6000 }).tone, 'off');
});

test('needing a login or a QR scan is called out', () => {
  assert.equal(buildView({ running: false, state: 'needs login' }).tone, 'bad');
  assert.equal(buildView({ running: true, state: 'waiting for QR scan' }).tone, 'busy');
});

test('the login toggle reflects the setting', () => {
  assert.equal(buildView(undefined, { autostart: true }).items.find((i) => i.id === 'autostart').checked, true);
});

test('dot pixmap is ARGB with a transparent corner and a coloured centre', () => {
  const [w, h, buf] = dotPixmap('#2fd08f', 24);
  assert.equal(buf.length, w * h * 4);
  assert.equal(buf[0], 0);
  const mid = ((12 * w) + 12) * 4;
  assert.deepEqual([...buf.subarray(mid, mid + 4)], [255, 0x2f, 0xd0, 0x8f]);
});

test('autostart entry quotes every argument', () => {
  assert.match(desktopEntry(['/a b/whatsgrep', '--config', '/c d/x.yaml', 'tray', 'run']), /Exec="\/a b\/whatsgrep" "--config" "\/c d\/x.yaml" "tray" "run"/);
});
