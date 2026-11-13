import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { deleteSecret } from './secrets.js';
import { parsePairingCode, sendPush } from './webpush.js';

// Paired devices (phones, tablets, laptops) live in the data folder, readable only by you. Each holds
// the push address, the keys to encrypt for it, and the key the push service ties that address to.
const file = (dataDir) => join(dataDir, 'devices.json');
const oldFile = (dataDir) => join(dataDir, 'phones.json'); // what an earlier version called it

export function listDevices(dataDir) {
  try {
    let text;
    try { text = readFileSync(file(dataDir), 'utf8'); } catch { text = readFileSync(oldFile(dataDir), 'utf8'); }
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function save(dataDir, phones) {
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${file(dataDir)}.tmp`;
  writeFileSync(tmp, JSON.stringify(phones, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file(dataDir));
  rmSync(oldFile(dataDir), { force: true });
}

// Pairing the same phone again replaces its entry instead of listing it twice.
export function addDevice(dataDir, phone) {
  const phones = listDevices(dataDir).filter((p) => p.endpoint !== phone.endpoint);
  const added = { id: randomBytes(4).toString('hex'), ...phone, name: phone.name || 'Device', addedAt: Date.now() };
  save(dataDir, [...phones, added]);
  return added;
}

export function removeDevice(dataDir, id) {
  const phones = listDevices(dataDir);
  if (!phones.some((p) => p.id === id)) return false;
  save(dataDir, phones.filter((p) => p.id !== id));
  return true;
}

// Which computer an alert comes from: a stable id and a name the phone shows (editable, the host name at first).
const identityFile = (dataDir) => join(dataDir, 'computer.json');
export function computerIdentity(dataDir) {
  let c = {};
  try { c = JSON.parse(readFileSync(identityFile(dataDir), 'utf8')); } catch {}
  if (c.id && c.name) return { id: c.id, name: c.name };
  const made = { id: c.id || randomBytes(4).toString('hex'), name: c.name || hostname().split('.')[0] || 'Computer' };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(identityFile(dataDir), JSON.stringify(made, null, 2) + '\n', { mode: 0o600 });
  return made;
}
export function setComputerName(dataDir, name) {
  const clean = String(name ?? '').trim().slice(0, 40);
  if (!clean) throw new Error('Give this computer a name.');
  const made = { ...computerIdentity(dataDir), name: clean };
  writeFileSync(identityFile(dataDir), JSON.stringify(made, null, 2) + '\n', { mode: 0o600 });
  return made;
}

export const publicDevice = ({ id, name, addedAt }) => ({ id, name, addedAt });

// Push services accept about 4 KB. Shorten the text rather than lose the alert.
function fit(message) {
  let m = message;
  while (Buffer.byteLength(JSON.stringify(m)) > 3000 && m.body.length > 20) m = { ...m, body: m.body.slice(0, Math.floor(m.body.length * 0.8)) + '…' };
  return m;
}

// Sends to every paired device (or one). A device that turned alerts off is forgotten.
export async function pushToDevices(dataDir, message, { priority, only, send } = {}) {
  const phones = listDevices(dataDir).filter((p) => !only || p.id === only);
  if (!phones.length) throw new Error('No device is paired. Add one under Delivery.');
  const failed = [];
  const from = computerIdentity(dataDir);
  const results = await Promise.allSettled(phones.map((p) => sendPush(p, fit({ ...message, computer: from }), { priority, send })));
  results.forEach((r, i) => {
    if (r.status === 'rejected') failed.push(`${phones[i].name}: ${r.reason.message}`);
    else if (r.value.gone) { removeDevice(dataDir, phones[i].id); failed.push(`${phones[i].name} turned alerts off, so it was removed`); }
  });
  if (failed.length === phones.length) throw new Error(failed[0]);
  return { sent: phones.length - failed.length, failed };
}

// ntfy is gone: its topic was a secret, so do not leave it lying around.
export function forgetLegacyTopic(dataDir) {
  deleteSecret('ntfy-topic');
  const state = join(dataDir, 'state.json');
  try {
    const { topic, ...rest } = JSON.parse(readFileSync(state, 'utf8'));
    if (topic === undefined) return;
    if (Object.keys(rest).length) writeFileSync(state, JSON.stringify(rest, null, 2) + '\n', { mode: 0o600 });
    else rmSync(state);
  } catch {}
}

// Pairing: read the code the device shows, prove the push works with a first message, then keep it.
export async function pairDevice(dataDir, code, { send } = {}) {
  const phone = parsePairingCode(code);
  let r;
  try { r = await sendPush(phone, { t: 'paired', title: 'whatsgrep', body: 'This device will now get your alerts.', computer: computerIdentity(dataDir) }, { send }); }
  catch (e) { throw new Error(`Could not reach the device (${e.message}). Check the connection and try again.`); }
  if (r.gone) throw new Error('Alerts are off on that device. Turn them on in the app and copy the code again.');
  return publicDevice(addDevice(dataDir, phone));
}
