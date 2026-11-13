import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notify } from '../src/core/notify.js';
import { addDevice, computerIdentity, listDevices, pairDevice, pushToDevices, setComputerName } from '../src/core/devices.js';
import { encrypt, isPushEndpoint, parsePairingCode, vapidHeader } from '../src/core/webpush.js';

const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');

// A phone: the keys its browser would make, and the code the app would show.
function fakePhone(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const vapid = createECDH('prime256v1'); vapid.generateKeys();
  const auth = randomBytes(16);
  const code = 'wg1.' + b64(JSON.stringify({ e: endpoint, p: b64(ua.getPublicKey()), a: b64(auth), d: b64(vapid.getPrivateKey()), n: 'Pixel' }));
  return { ua, auth, vapid, code };
}

// What a browser does with a push body (RFC 8291), so the test reads what the phone would.
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const as = body.subarray(21, 21 + idlen);
  const ikm = hkdfSync('sha256', ua.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32);
  const cek = hkdfSync('sha256', Buffer.from(ikm), salt, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdfSync('sha256', Buffer.from(ikm), salt, 'Content-Encoding: nonce\0', 12);
  const rec = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', Buffer.from(cek), Buffer.from(nonce));
  d.setAuthTag(rec.subarray(-16));
  const plain = Buffer.concat([d.update(rec.subarray(0, -16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString('utf8');
}

test('encryption matches the RFC 8291 example byte for byte', () => {
  const body = encrypt('When I grow up, I want to be a watermelon',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    { salt: unb64('DGv6ra1nlYgDCS1FRnbzlw'), ephemeral: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', pad: 1 });
  assert.equal(b64(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('a pairing code is checked before it is trusted', () => {
  const p = fakePhone();
  assert.equal(parsePairingCode(p.code).name, 'Pixel');
  assert.equal(parsePairingCode(`  ${p.code.slice(0, 20)}\n${p.code.slice(20)}  `).endpoint, 'https://fcm.googleapis.com/fcm/send/abc'); // pasted with line breaks
  assert.throws(() => parsePairingCode('hello'), /not a device code/);
  assert.throws(() => parsePairingCode('wg1.!!!'), /damaged/);
  assert.throws(() => parsePairingCode(fakePhone('https://evil.example/x').code), /unknown push service/);
  assert.throws(() => parsePairingCode(fakePhone('http://fcm.googleapis.com/x').code), /unknown push service/);
  assert.ok(isPushEndpoint('https://web.push.apple.com/abc') && isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!isPushEndpoint('https://127.0.0.1/x') && !isPushEndpoint('https://fcm.googleapis.com.evil.example/x'));
});

test('a paired device receives alerts only it can read; a gone device is forgotten', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-phone-'));
  const p = fakePhone();
  const sent = [];
  let status = 201;
  const send = async (url, init) => { sent.push({ url, init }); return { ok: status < 300, status }; };

  const paired = await pairDevice(dir, p.code, { send });
  assert.equal(paired.name, 'Pixel');
  assert.equal(statSync(join(dir, 'devices.json')).mode & 0o077, 0, 'devices.json is private');
  assert.equal(decrypt(Buffer.from(sent[0].init.body), p.ua, p.auth).includes('This device will now get your alerts'), true);

  await pushToDevices(dir, { t: 'alert', title: 'sale · Market', body: 'laptop for sale नमस्ते', at: 1 }, { priority: 'high', send });
  const { url, init } = sent[1];
  assert.equal(url, 'https://fcm.googleapis.com/fcm/send/abc');
  assert.equal(init.headers.Urgency, 'high');
  assert.match(init.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
  const { computer, ...alert } = JSON.parse(decrypt(Buffer.from(init.body), p.ua, p.auth));
  assert.deepEqual(alert, { t: 'alert', title: 'sale · Market', body: 'laptop for sale नमस्ते', at: 1 });
  assert.match(computer.id, /^[0-9a-f]{8}$/);              // the phone is told which computer sent it
  assert.ok(computer.name);
  assert.equal(setComputerName(dir, 'Home PC').name, 'Home PC');
  assert.equal(computerIdentity(dir).id, computer.id);     // renaming keeps the same computer
  assert.ok(!Buffer.from(init.body).toString('utf8').includes('laptop'), 'the push service sees no plain text');

  await pushToDevices(dir, { t: 'alert', title: 't', body: 'x'.repeat(20000) }, { send }); // too long: shortened, not lost
  assert.ok(Buffer.from(sent[2].init.body).length <= 4096);

  status = 410;
  await assert.rejects(pushToDevices(dir, { t: 'test', title: 't', body: 'b' }, { send }), /turned alerts off/);
  assert.deepEqual(listDevices(dir), []);
  await assert.rejects(pushToDevices(dir, { t: 'test', title: 't', body: 'b' }, { send }), /No device is paired/);
});

test('pairing fails clearly when the push service refuses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-phone-'));
  await assert.rejects(pairDevice(dir, fakePhone().code, { send: async () => ({ ok: false, status: 403 }) }), /Could not reach the device \(the push service answered 403\)/);
  assert.deepEqual(listDevices(dir), []);
});

test('pairing the same device twice keeps one entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-phone-'));
  const phone = parsePairingCode(fakePhone().code);
  addDevice(dir, phone); addDevice(dir, phone);
  assert.equal(listDevices(dir).length, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8'))[0].endpoint, phone.endpoint);
});

test('a VAPID header carries a JWT for the push service origin', () => {
  const k = createECDH('prime256v1'); k.generateKeys();
  const h = vapidHeader('https://web.push.apple.com/abc', b64(k.getPrivateKey()), 1_000_000_000_000);
  const claims = JSON.parse(unb64(h.match(/t=[^.]+\.([^.]+)\./)[1]).toString());
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.exp, 1_000_000_000 + 12 * 3600);
  assert.match(claims.sub, /^https:\/\//);
});

test('an alert from the runtime reaches the device through notify', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-phone-'));
  const p = fakePhone();
  addDevice(dir, parsePairingCode(p.code));
  const real = globalThis.fetch;
  const got = [];
  globalThis.fetch = async (url, init) => { got.push({ url, init }); return { ok: true, status: 201 }; };
  try {
    const r = await notify(['devices'], { rule: 'sale', dataDir: dir, tracker: 'WhatsApp', chat: 'Market', title: 'sale · Market', message: 'laptop for sale', priority: 'urgent' });
    assert.deepEqual(r, [{ method: 'devices', ok: true, error: undefined }]);
  } finally { globalThis.fetch = real; }
  assert.equal(got[0].init.headers.Urgency, 'high');
  const m = JSON.parse(decrypt(Buffer.from(got[0].init.body), p.ua, p.auth));
  assert.deepEqual({ t: m.t, title: m.title, body: m.body, rule: m.rule, chat: m.chat, tracker: m.tracker }, { t: 'alert', title: 'sale · Market', body: 'laptop for sale', rule: 'sale', chat: 'Market', tracker: 'WhatsApp' });
});

test('the app uses the same accent as the interface', () => {
  const accent = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').match(/--accent: [^;]+; --accent-hover: [^;]+; --accent-ink: [^;]+; --accent-soft: [^;]+;/)?.[0];
  assert.ok(accent('../src/ui/styles.css'));
  assert.equal(accent('../docs/app/app.css'), accent('../src/ui/styles.css'));
});

test('a test can go to one device only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-phone-'));
  const a = fakePhone('https://fcm.googleapis.com/fcm/send/aaa');
  const b = fakePhone('https://fcm.googleapis.com/fcm/send/bbb');
  const send = async () => ({ ok: true, status: 201 });
  const first = await pairDevice(dir, a.code, { send });
  await pairDevice(dir, b.code, { send });
  const urls = [];
  await pushToDevices(dir, { t: 'test', title: 't', body: 'b' }, { only: first.id, send: async (url) => { urls.push(url); return { ok: true, status: 201 }; } });
  assert.deepEqual(urls, ['https://fcm.googleapis.com/fcm/send/aaa']);
});
