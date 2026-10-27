import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { compileRule, matches } from '../src/matcher.js';
import { formToRule, ruleToForm } from '../src/ruleform.js';
import { startServer } from '../src/server.js';
import { qrSvg } from '../src/qrsvg.js';

const SAMPLES = ['selling lunch coupon', 'anyone selling srr coupon', 'buy bf coupon', 'Rs 5000 laptop for sale', 'free pickup bike', 'giveaway', 'hello', 'selling notebooks'];
const CHATS = ['Market Group', '919812340000', 'Neighbourhood Market', 'my classifieds archive', 'Hostel Announcements', 'Other', 'buy & sell group'];

test('rules survive the UI form round trip with identical behaviour', () => {
  const doc = parse(readFileSync(new URL('../config.example.yaml', import.meta.url), 'utf8'));
  const extra = [
    { name: 'old', chats: ['Market Group'], all: [['sell', 'selling'], ['lunch']], none: [['buy', 'wtb']] },
    { name: 'phone', from: ['+91 98765-43210'], message: ['hi'] },
    { name: 'nested', message: { any: [['sale', 'selling']], exclude: [['buy', 'wtb']] } },
  ];
  for (const raw of [...doc.rules, ...extra]) {
    const a = compileRule(raw);
    const b = compileRule(formToRule(ruleToForm(raw)));
    for (const t of SAMPLES) for (const c of [...CHATS, '919876543210@c.us']) {
      assert.equal(matches(b, t, [c]), matches(a, t, [c]), `${raw.name}: "${t}" in "${c}"`);
    }
  }
});

test('phone entries stay plain so they keep matching by suffix', () => {
  const rule = formToRule({ name: 'p', from: { any: [{ kind: 'phone', value: '9876543210' }], all: [], exclude: [] }, message: { any: [{ kind: 'exact', value: 'hi' }], all: [], exclude: [] } });
  assert.deepEqual(rule.from.any, ['9876543210']);
  assert.ok(matches(compileRule(rule), 'hi', ['', '919876543210@c.us']));
});

test('qrSvg renders an svg', () => {
  assert.match(qrSvg('hello'), /^<svg[^>]+viewBox/);
});

test('ui server: auth, host checks and saving rules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-'));
  const configFile = join(dir, 'config.yaml');
  writeFileSync(configFile, '# my header\nnotifications: [desktop]\nrules:\n  # keep me\n  - name: a\n    message: [hello]\n');
  const { server, url } = await startServer({ configFile, dataDir: join(dir, 'data'), serviceArgs: [] });
  try {
    const base = new URL(url).origin;
    const token = new URL(url).searchParams.get('t');
    const call = (method, path, body) => fetch(base + path, { method, headers: { 'x-token': token, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });

    assert.equal((await fetch(base + '/api/state')).status, 401);
    // fetch() won't let a script spoof Host/Origin, so use a raw request like an attacker's would.
    const raw = (method, path, headers) => new Promise((resolve, reject) => {
      const u = new URL(base);
      const req = request({ host: u.hostname, port: u.port, method, path, headers: { 'x-token': token, ...headers } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(await raw('GET', '/api/state', { host: 'evil.example' }), 403);
    assert.equal(await raw('PUT', '/api/config', { origin: 'http://evil.example' }), 403);

    const state = await (await call('GET', '/api/state')).json();
    assert.deepEqual(state.config.notifications, ['desktop']);
    assert.equal(state.rules[0].name, 'a');

    const add = { name: 'b', priority: 'high', from: { any: [], all: [], exclude: [] }, message: { any: [{ kind: 'contains', value: 'sale' }], all: [], exclude: [] } };
    const saved = await call('PUT', '/api/config', { rules: [state.rules[0], add], notifications: ['desktop', 'ntfy'] });
    assert.equal(saved.status, 200);
    const text = readFileSync(configFile, 'utf8');
    assert.match(text, /# my header/);
    assert.match(text, /# keep me/);       // untouched rule keeps its comment
    assert.match(text, /notifications: \[desktop, ntfy\]/);
    assert.match(text, /name: b/);

    const dup = await call('PUT', '/api/config', { rules: [add, add] });
    assert.equal(dup.status, 400);
    assert.match((await dup.json()).error, /unique/);
    assert.equal(readFileSync(configFile, 'utf8'), text); // a refused save changes nothing

    const t = await (await call('POST', '/api/rule/test', { rule: add, chat: 'x', text: 'for sale' })).json();
    assert.equal(t.matched, true);
  } finally {
    server.close();
  }
});
