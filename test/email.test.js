import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/core/config.js';
import { appliesTo, matchesMail } from '../src/core/rule.js';
import { preview } from '../src/core/mail.js';
import { attachmentsOf, parseMail } from '../src/trackers/email/parse.js';
import { listFolders, watchAccount } from '../src/trackers/email/watch.js';
import { providerFor } from '../src/trackers/email/providers.js';

const require = createRequire(import.meta.url);
const imap = require('hoodiecrow-imap');

const raw = (from, subject, body) => `From: ${from}\r\nTo: me@test.local\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: <${Math.random()}@t>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;

test('trackers are read from the config, and older configs keep one WhatsApp account', () => {
  const c = parseConfig(`notifications: [desktop]
trackers:
  - {name: WhatsApp, type: whatsapp}
  - {name: Work Gmail, type: email, user: a@gmail.com, provider: gmail}
rules:
  - {name: x, on: [Work Gmail], message: {any: [invoice]}}
  - {name: y, on: all, message: {any: [sale]}}
  - {name: z, message: {any: [hello]}}
`);
  const [wa, mail] = c.trackers;
  assert.deepEqual([mail.host, mail.port, mail.secure, mail.folders, mail.id], ['imap.gmail.com', 993, true, ['INBOX'], 'work-gmail']);
  const on = c.rules.map((r) => [appliesTo(r, wa), appliesTo(r, mail)]);
  assert.deepEqual(on, [[false, true], [true, true], [true, false]]); // no `on:` = WhatsApp only, as before
  assert.deepEqual(parseConfig('rules: []').trackers.map((t) => t.type), ['whatsapp']);
});

test('bad tracker settings are refused', () => {
  assert.throws(() => parseConfig('trackers:\n  - {name: A, type: email, user: a@x.com}\n'), /host/);
  assert.throws(() => parseConfig('trackers:\n  - {name: A, type: email, user: a@x.com, host: h}\n  - {name: a, type: whatsapp}\n'), /twice/);
  assert.throws(() => parseConfig('trackers:\n  - {name: A, type: sms}\n'), /type must be/);
});

const sample = (over = {}) => ({ fromName: 'Big Boss', fromAddress: 'ceo@boss.com', to: ['me@x.com'], cc: [], subject: 'Quick call', text: 'Can you talk about the invoice?', size: 40000, attachments: [], bulk: false, auto: false, important: false, verified: 'pass', ...over });
const rules = (yaml) => parseConfig(`rules:\n${yaml}`).rules;

test('mail is matched on sender and on subject plus body', () => {
  const [domain, words, other] = rules(`  - {name: domain, from: {contains: ['@boss.com']}}
  - {name: words, message: {any: [invoice]}}
  - {name: other, message: {any: [holiday]}}
`);
  const mail = sample();
  assert.deepEqual([domain, words, other].map((r) => matchesMail(r, mail)), [true, true, false]);
  assert.match(preview(mail), /^Quick call\nCan you talk/);
});

test('email conditions: recipients, subject, attachments, size, newsletters, checks, hours', () => {
  const r = (cond) => rules(`  - name: r\n    message: {any: [invoice]}\n    email: ${cond}\n`)[0];
  const pdf = [{ name: 'invoice.pdf', type: 'application/pdf', size: 9000 }];
  assert.equal(matchesMail(r('{to: {any: [me@x.com]}}'), sample()), true);
  assert.equal(matchesMail(r('{to: {any: [other@x.com]}}'), sample()), false);
  assert.equal(matchesMail(r('{subject: {any: [call], exclude: [newsletter]}}'), sample()), true);
  assert.equal(matchesMail(r('{attachment: true}'), sample()), false);
  assert.equal(matchesMail(r('{attachment: [pdf]}'), sample({ attachments: pdf })), true);
  assert.equal(matchesMail(r('{attachment: [xlsx]}'), sample({ attachments: pdf })), false);
  assert.equal(matchesMail(r('{larger_than: 1MB}'), sample()), false);
  assert.equal(matchesMail(r('{smaller_than: 1MB}'), sample()), true);
  assert.equal(matchesMail(r('{not_bulk: true}'), sample({ bulk: true })), false);
  assert.equal(matchesMail(r('{verified: true}'), sample({ verified: 'none' })), false);
  assert.equal(matchesMail(r('{important: true}'), sample({ important: true })), true);
  const work = r('{during: {days: [mon, tue, wed, thu, fri], from: "09:00", to: "18:00"}}');
  assert.equal(matchesMail(work, sample(), new Date('2026-11-02T10:30:00')), true);   // Monday morning
  assert.equal(matchesMail(work, sample(), new Date('2026-11-02T20:00:00')), false);  // Monday evening
  assert.equal(matchesMail(work, sample(), new Date('2026-11-01T10:30:00')), false);  // Sunday
});

test('a raw message is read into sender, recipients and the flags rules use', async () => {
  const mail = await parseMail(Buffer.from([
    'From: "Shop" <news@shop.com>', 'To: me@x.com, you@x.com', 'Cc: boss@x.com', 'Subject: Big sale', 'Message-ID: <1@x>',
    'List-Unsubscribe: <mailto:u@shop.com>', 'X-Priority: 1 (Highest)', 'Authentication-Results: mx.x.com; dkim=pass; spf=pass',
    'Content-Type: text/plain', '', 'Everything is cheap.', '',
  ].join('\r\n')));
  assert.deepEqual([mail.fromName, mail.fromAddress, mail.to, mail.cc], ['Shop', 'news@shop.com', ['me@x.com', 'you@x.com'], ['boss@x.com']]);
  assert.deepEqual([mail.bulk, mail.important, mail.verified], [true, true, 'pass']);
  const structure = { childNodes: [{ type: 'text/plain' }, { type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'a.pdf' }, size: 900 }, { type: 'image/png', disposition: 'inline' }] };
  assert.deepEqual(attachmentsOf(structure), [{ name: 'a.pdf', type: 'application/pdf', size: 900 }]);
});

test('providers are guessed from the address', () => {
  assert.equal(providerFor('me@gmail.com'), 'gmail');
  assert.equal(providerFor('me@hotmail.co.uk'), 'outlook');
  assert.equal(providerFor('me@company.org'), 'other');
});

test('new mail reaches the watcher at once, including several in a row', async () => {
  const server = imap({ plugins: ['ID', 'IDLE', 'LITERALPLUS'], id: { name: 'fake', version: '1' }, storage: { INBOX: { messages: [{ raw: raw('Old <o@x.com>', 'old', 'x'), flags: ['\\Seen'] }] } }, users: { me: { password: 'pw' } } });
  await new Promise((r) => server.listen(0, r));
  const port = (server.server ?? server).address().port;
  const dir = mkdtempSync(join(tmpdir(), 'wg-email-'));
  const got = [];
  let connected;
  const ready = new Promise((r) => { connected = r; });
  const w = watchAccount({ name: 'T', user: 'me', host: '127.0.0.1', port, secure: false, folder: 'INBOX' }, 'pw', {
    dataDir: dir,
    onStatus: (s) => { if (s.state === 'connected') connected(); },
    onMail: (m) => { got.push(m.subject); },
  });
  try {
    await ready;
    const start = Date.now();
    for (const s of ['one', 'two', 'three']) server.appendMessage('INBOX', [], new Date(), raw('A <a@x.com>', s, 'body'));
    while (got.length < 3 && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(got, ['one', 'two', 'three']); // the old, already-read mail is not alerted
    assert.ok(Date.now() - start < 3000);
  } finally {
    w.stop();
    server.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('folders can be listed, and a tracker may watch at most five', async () => {
  const server = imap({ plugins: ['ID', 'IDLE', 'LITERALPLUS'], id: { name: 'fake', version: '1' }, storage: { INBOX: { messages: [] }, '': { separator: '/', folders: { Work: { messages: [] }, Invoices: { messages: [] } } } }, users: { me: { password: 'pw' } } });
  await new Promise((r) => server.listen(0, r));
  const port = (server.server ?? server).address().port;
  try {
    const r = await listFolders({ user: 'me', host: '127.0.0.1', port, secure: false }, 'pw');
    assert.equal(r.ok, true);
    assert.deepEqual(r.folders.map((f) => f.path), ['INBOX', 'Invoices', 'Work']);
    assert.equal((await listFolders({ user: 'me', host: '127.0.0.1', port, secure: false }, 'wrong')).ok, false);
  } finally { server.close?.(); }
  const six = 'trackers:\n  - {name: A, type: email, user: a@x.com, host: h, folders: [1, 2, 3, 4, 5, 6]}\nrules: []\n';
  assert.throws(() => parseConfig(six), /limit is 5/);
  assert.equal(parseConfig(six.replace(', 6', '')).trackers[0].folders.length, 5);
});

test('a subject can be matched exactly, and the body on its own', () => {
  const r = (cond) => rules(`  - name: r\n    email: ${cond}\n`)[0];
  assert.equal(matchesMail(r('{subject: {equals: ["Quick call"]}}'), sample()), true);
  assert.equal(matchesMail(r('{subject: {equals: ["quick  CALL"]}}'), sample()), true);                 // case and spacing do not matter
  assert.equal(matchesMail(r('{subject: {equals: ["Quick call"]}}'), sample({ subject: 'Re: Quick call' })), false); // but the whole subject must match
  assert.equal(matchesMail(r('{subject: {contains: ["call"]}}'), sample({ subject: 'Re: Quick call' })), true);
  assert.equal(matchesMail(r('{body: {any: [invoice]}}'), sample()), true);
  assert.equal(matchesMail(r('{body: {any: [invoice]}}'), sample({ subject: 'invoice', text: 'hello' })), false); // the subject is not the body
  assert.equal(matchesMail(r('{body: {exclude: [invoice]}}'), sample()), false);
  // only what a rule names is checked: subject and sender, nothing about the body
  const [only] = rules(`  - {name: s, from: {exact: ["ceo@boss.com"]}, email: {subject: {equals: ["Quick call"]}}}\n`);
  assert.equal(matchesMail(only, sample({ text: 'completely different' })), true);
});
