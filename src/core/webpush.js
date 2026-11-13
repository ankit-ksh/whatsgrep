import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

// Web Push (RFC 8030) with encrypted payloads (RFC 8291, aes128gcm) and VAPID (RFC 8292), on
// Node's own crypto. The push service (Google, Apple, Mozilla) only ever carries ciphertext.

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url');

// Push services we will send to. A pairing code is pasted by a person, so keep it from pointing
// this computer at some other address.
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
export const isPushEndpoint = (endpoint) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
};

// The pairing code a device shows: its push address and keys, and the VAPID key that address is bound to.
const CODE_PREFIX = 'wg1.';
export function parsePairingCode(text) {
  const raw = String(text ?? '').trim().replace(/\s+/g, '');
  if (!raw.startsWith(CODE_PREFIX)) throw new Error('That is not a device code. Copy it again from the app.');
  let c;
  try { c = JSON.parse(unb64(raw.slice(CODE_PREFIX.length)).toString('utf8')); } catch { throw new Error('That device code is damaged. Copy it again from the app.'); }
  const phone = { endpoint: String(c.e ?? ''), p256dh: String(c.p ?? ''), auth: String(c.a ?? ''), vapidKey: String(c.d ?? ''), name: String(c.n ?? '').trim().slice(0, 40) };
  if (!isPushEndpoint(phone.endpoint)) throw new Error('That device code points to an unknown push service.');
  if (unb64(phone.p256dh).length !== 65 || unb64(phone.p256dh)[0] !== 4 || unb64(phone.auth).length !== 16 || unb64(phone.vapidKey).length !== 32) throw new Error('That device code is damaged. Copy it again from the app.');
  return phone;
}

// ECDSA P-256 key from its 32-byte private value (the public half is derived from it).
function vapidKeys(privateB64) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(unb64(privateB64));
  const pub = ecdh.getPublicKey();
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)), d: privateB64 }, format: 'jwk' });
  return { key, publicKey: b64(pub) };
}

export function vapidHeader(endpoint, privateB64, now = Date.now(), subject = 'https://github.com/ankit-ksh/whatsgrep') {
  const { key, publicKey } = vapidKeys(privateB64);
  const head = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64(sig)}, k=${publicKey}`;
}

const RECORD = 4096;

// RFC 8291: one record, padded so the length gives little away. `salt` and `ephemeral` are only
// passed by tests, to reproduce the RFC's example.
export function encrypt(plaintext, p256dh, auth, { salt = randomBytes(16), ephemeral, pad = 256 } = {}) {
  const ua = unb64(p256dh);
  const ecdh = createECDH('prime256v1');
  if (ephemeral) ecdh.setPrivateKey(unb64(ephemeral)); else ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(hkdfSync('sha256', shared, unb64(auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const data = Buffer.from(plaintext);
  const room = RECORD - 16 - 1 - 86; // header and tag take the rest of the record
  if (data.length > room) throw new Error('message too long');
  const padded = Buffer.concat([data, Buffer.from([2]), Buffer.alloc(Math.min(room - data.length, (pad - ((data.length + 1) % pad)) % pad))]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head);
  head.writeUInt32BE(RECORD, 16);
  head[20] = as.length;
  return Buffer.concat([head, as, body]);
}

const URGENCY = { min: 'very-low', low: 'low', default: 'normal', high: 'high', urgent: 'high' };

// Sends one message to one paired device. Resolves { ok } or { gone: true } when the device
// unsubscribed (the push service says 404/410) and should be forgotten.
export async function sendPush(phone, message, { priority = 'default', send = fetch } = {}) {
  const body = encrypt(JSON.stringify(message), phone.p256dh, phone.auth);
  const res = await send(phone.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(phone.endpoint, phone.vapidKey),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: URGENCY[priority] ?? 'normal',
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404 || res.status === 410) return { gone: true };
  if (!res.ok) throw new Error(`the push service answered ${res.status}`);
  return { ok: true };
}
