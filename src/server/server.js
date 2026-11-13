import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { isScalar, parseDocument, visit } from 'yaml';
import { findBrowser } from '../system/browser.js';
import { parseConfig, slug } from '../core/config.js';
import { restartTracker, startTracker, stopTracker, tailLog } from '../system/control.js';
import { compileRule, matchesChat, matchesMessage, isUsable } from '../core/rule.js';
import { matchSection } from '../core/matcher.js';
import { notify } from '../core/notify.js';
import { qrSvg } from '../core/qrsvg.js';
import { formToRule, ruleToForm } from '../core/ruleform.js';
import { getAsset } from '../core/sea.js';
import { isServiceInstalled, manageService } from '../system/service.js';
import { clearAccount, clearMatches, readAccount, readChats, readMatches, readStatus, sendCommand } from '../core/status.js';
import { trackerDir } from '../core/paths.js';
import { matchesMail } from '../core/rule.js';
import { forgetEmailPassword, hasEmailPassword, emailPassword, saveEmailPassword } from '../trackers/email/password.js';
import { PROVIDERS, providerFor } from '../trackers/email/providers.js';
import { listFolders, previewMail, testAccount } from '../trackers/email/watch.js';
import { computerIdentity, listDevices, pairDevice, publicDevice, pushToDevices, removeDevice, setComputerName } from '../core/devices.js';
import { storeName } from '../core/secrets.js';
import { defaultConfigText } from '../commands/commands.js';
import { VERSION } from '../core/version.js';
import { buildUiHtml } from '../ui/build.js';

const PRIORITIES = ['min', 'low', 'default', 'high', 'urgent'];

const pageHtml = async () => getAsset('ui.html') ?? (await buildUiHtml());

class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const FMT = { flowCollectionPadding: false, lineWidth: 0 };

// Short lists of plain values read better inline: [a, b, c].
function flowify(doc) {
  visit(doc, { Seq(_, node) { if (node.items.every(isScalar)) node.flow = true; } });
}

function readDoc(file) {
  if (!existsSync(file)) throw new HttpError('No config file yet. Create one first.', 404);
  return parseDocument(readFileSync(file, 'utf8'));
}

function writeDoc(file, doc) {
  flowify(doc);
  const text = doc.toString(FMT);
  parseConfig(text); // refuse anything that would not load
  writeFileSync(file, text);
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A tracker as the interface edits it -> as it is written in the config (only what differs from the defaults).
function trackerToYaml(t) {
  const name = String(t.name ?? '').trim();
  if (!name) throw new HttpError('Every tracker needs a name.');
  const def = { id: String(t.id || slug(name)), name, type: t.type };
  if (!['whatsapp', 'email'].includes(t.type)) throw new HttpError('Unknown tracker type.');
  if (t.enabled === false) def.enabled = false;
  if (t.type === 'email') {
    def.user = String(t.user ?? '').trim();
    if (t.provider && t.provider !== 'other') def.provider = t.provider;
    if (!t.provider || t.provider === 'other' || (t.host && t.host !== PROVIDERS[t.provider]?.host)) def.host = String(t.host ?? '').trim();
    if (t.port && Number(t.port) !== 993) def.port = Number(t.port);
    const folders = [t.folders ?? []].flat().map((f) => String(f).trim()).filter(Boolean);
    if (folders.length && !(folders.length === 1 && folders[0] === 'INBOX')) def.folders = folders;
  }
  return def;
}
const normalizeTracker = (t) => ({ ...t, enabled: t.enabled !== false, folders: t.folders ?? t.folder ?? ['INBOX'] });

// Applies UI settings to the YAML document, keeping its comments and untouched rules as written.
function applySettings(doc, body) {
  if (body.notifications !== undefined && !body.notifications.length) throw new HttpError('Keep at least one notification type on.');
  if (body.notifications !== undefined) doc.set('notifications', doc.createNode(body.notifications));
  if (body.repeatWindowHours !== undefined) doc.setIn(['settings', 'repeat_window_hours'], Number(body.repeatWindowHours));
  if (body.browser !== undefined) {
    if (String(body.browser).trim()) doc.set('browser', String(body.browser).trim());
    else doc.delete('browser');
  }
  if (body.trackers !== undefined) {
    const defs = body.trackers.map(trackerToYaml);
    const existing = new Map((doc.get('trackers', true)?.items ?? []).map((n) => [String(n.get?.('id') ?? slug(String(n.get?.('name') ?? ''))), n]));
    const items = defs.map((def) => {
      const old = existing.get(def.id);
      if (old && sameJson(normalizeTracker(old.toJSON()), normalizeTracker(def))) return old;
      const node = doc.createNode(def);
      node.flow = true;
      return node;
    });
    const seq = doc.get('trackers', true);
    if (seq?.items) seq.items = items;
    else doc.set('trackers', doc.createNode(items));
  }
  if (body.rules !== undefined) {
    const names = body.rules.map((r) => String(r.name ?? '').trim());
    if (names.some((n) => !n)) throw new HttpError('Every rule needs a name.');
    if (new Set(names).size !== names.length) throw new HttpError('Rule names must be unique.');
    const existing = new Map((doc.get('rules', true)?.items ?? []).map((n) => [n.get?.('name'), n]));
    const items = body.rules.map((form) => {
      const rule = formToRule(form);
      const old = existing.get(rule.name);
      // A rule that was not changed keeps its original text and comments.
      if (old && sameJson(formToRule(ruleToForm(old.toJSON())), rule)) return old;
      return doc.createNode(rule);
    });
    // Reuse the existing list node so comments attached to it survive.
    const seq = doc.get('rules', true);
    if (seq?.items) seq.items = items;
    else doc.set('rules', doc.createNode(items));
  }
}

// Bump when the page needs API routes an older running server does not have.
export const API_VERSION = 8;

export function startServer(ctx, { port = 0 } = {}) {
  const { configFile, dataDir, serviceArgs, profile = null } = ctx;
  const token = randomBytes(18).toString('base64url');
  let origin;

  const loadState = () => {
    let config = null;
    let rules = [];
    let trackers = [];
    let configError;
    if (existsSync(configFile)) {
      try {
        const doc = readDoc(configFile).toJSON() ?? {};
        const parsed = parseConfig(readFileSync(configFile, 'utf8'));
        config = { notifications: parsed.methods, repeatWindowHours: parsed.repeatWindowMs / 3600e3, browser: parsed.browser ?? '' };
        trackers = parsed.trackers.map((t) => ({ ...t, hasPassword: t.type === 'email' ? hasEmailPassword(t) : undefined, account: t.type === 'whatsapp' ? readAccount(trackerDir(dataDir, t)) ?? null : undefined, hasSession: t.type === 'whatsapp' ? existsSync(join(trackerDir(dataDir, t), 'auth')) : undefined }));
        rules = (doc.rules ?? []).map(ruleToForm);
      } catch (e) {
        configError = e.message;
      }
    }
    let browser = null;
    try { browser = findBrowser({ override: config?.browser || undefined }) ?? null; } catch {}
    return {
      version: VERSION,
      apiVersion: API_VERSION,
      pid: process.pid,
      platform: process.platform,
      configFile, dataDir, profile,
      configExists: existsSync(configFile),
      configError,
      config, rules, trackers,
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p })),
      status: readStatus(dataDir) ?? null,
      recentMatches: readMatches(dataDir, 20),
      matchTotal: readMatches(dataDir).length,
      runAtLogin: !profile && isServiceInstalled(),
      browserFound: browser,
      priorities: PRIORITIES,
      keychain: storeName(),
    };
  };

  const savedTrackers = () => parseConfig(readFileSync(configFile, 'utf8')).trackers;
  const whatsappTracker = (id) => {
    const list = savedTrackers().filter((t) => t.type === 'whatsapp');
    const t = id ? list.find((x) => x.id === id) : list[0];
    if (!t) throw new HttpError('No such WhatsApp tracker.', 404);
    return t;
  };
  const emailTracker = (id) => {
    const t = savedTrackers().find((x) => x.type === 'email' && x.id === id);
    if (!t) throw new HttpError('No such email tracker. Save your changes first.', 404);
    return t;
  };
  // The connection settings the form sends, with the provider's defaults filled in.
  const mailAccount = (b) => {
    const preset = PROVIDERS[b.provider];
    const host = String(b.host || preset?.host || '').trim();
    if (!host) throw new HttpError('Enter the mail server.');
    const port = Number(b.port || preset?.port || 993);
    return { host, port, secure: b.secure ?? port !== 143, user: String(b.user ?? '').trim(), folder: String(b.folder || 'INBOX') };
  };

  const routes = {
    'GET /api/state': () => loadState(),
    'POST /api/config/init': () => {
      if (!existsSync(configFile)) { mkdirSync(dirname(configFile), { recursive: true }); writeFileSync(configFile, defaultConfigText()); }
      return loadState();
    },
    'PUT /api/config': (body) => {
      const doc = readDoc(configFile);
      applySettings(doc, body);
      writeDoc(configFile, doc);
      return loadState();
    },
    'GET /api/yaml': () => ({ text: existsSync(configFile) ? readFileSync(configFile, 'utf8') : '' }),
    'PUT /api/yaml': (body) => {
      parseConfig(String(body.text));
      mkdirSync(dirname(configFile), { recursive: true });
      writeFileSync(configFile, String(body.text));
      return loadState();
    },
    // Would this rule fire for a sample? Chat and words for WhatsApp; sender, subject and body for email.
    'POST /api/rule/test': (body) => {
      const rule = compileRule(formToRule(body.rule));
      if (!isUsable(rule)) return { usable: false, matched: false };
      const mail = body.subject !== undefined || body.body !== undefined;
      const subject = String(body.subject ?? ''), text = String(mail ? body.body : body.text ?? '');
      const chat = matchesChat(rule, [body.chat ?? '']);
      const message = matchesMessage(rule, mail ? `${subject}\n\n${text}`.trim() : text);
      const subjectOk = !rule.email?.subject || matchSection(rule.email.subject, (re) => re.test(subject));
      const bodyOk = !rule.email?.body || matchSection(rule.email.body, (re) => re.test(text));
      return { usable: true, chat, message, subject: subjectOk, body: bodyOk, matched: chat && message && subjectOk && bodyOk };
    },
    'GET /api/notifications': () => ({ items: readMatches(dataDir) }),
    'POST /api/notifications/clear': () => { clearMatches(dataDir); return {}; },
    'GET /api/chats': (_, q) => {
      const t = whatsappTracker(q.get('tracker'));
      const st = readStatus(dataDir);
      const live = st?.running ? st.trackers?.find((x) => x.id === t.id) : undefined;
      return { ...readChats(trackerDir(dataDir, t)), running: !!st?.running, linked: !!live?.account };
    },
    'POST /api/chats/refresh': (body) => {
      const t = whatsappTracker(body.tracker);
      if (!readStatus(dataDir)?.running) return { running: false };
      sendCommand(dataDir, 'chats', { tracker: t.id });
      return { running: true };
    },
    // Check the connection, start linking (shows a QR), or log out of one WhatsApp tracker.
    'POST /api/tracker/command': (body) => {
      const t = whatsappTracker(body.tracker);
      const running = !!readStatus(dataDir)?.running;
      if (body.action === 'logout' && !running) {
        // Tracker is stopped: only the saved session on this computer can be removed.
        rmSync(join(trackerDir(dataDir, t), 'auth'), { recursive: true, force: true });
        clearAccount(trackerDir(dataDir, t));
        return { message: 'Removed the saved session. Also remove “whatsgrep” under Linked devices on your phone if it is still listed.' };
      }
      if (!['check', 'login', 'logout'].includes(body.action)) throw new HttpError('unknown action');
      if (!running) return { running: false };
      sendCommand(dataDir, body.action, { tracker: t.id });
      return { running: true, message: body.action === 'logout' ? 'Logging out…' : undefined };
    },
    'PUT /api/tracker/password': (body) => {
      const t = emailTracker(body.id);
      if (!String(body.password ?? '')) throw new HttpError('Enter the password.');
      if (!saveEmailPassword(t, String(body.password))) throw new HttpError(`Could not save to ${storeName()}. Set the environment variable WHATSGREP_EMAIL_PASSWORD_${t.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')} instead.`);
      return {};
    },
    'POST /api/tracker/forget': (body) => { forgetEmailPassword(String(body.id)); return {}; },
    // Try a mailbox login without saving anything. `id` reuses the saved password.
    'POST /api/email/test': async (body) => {
      const acct = mailAccount(body);
      const password = body.password ? String(body.password) : body.id ? emailPassword(emailTracker(body.id)) : undefined;
      if (!password) throw new HttpError('Enter the password first.');
      const r = await testAccount(acct, acct.host.includes('gmail') ? password.replace(/\s+/g, '') : password);
      return r.ok ? { ok: true, messages: r.messages } : { ok: false, error: r.error };
    },
    // The account's folders, for the picker. Read-only, one short connection.
    'POST /api/email/folders': async (body) => {
      const acct = mailAccount(body);
      const password = body.password ? String(body.password) : body.id ? emailPassword(emailTracker(body.id)) : undefined;
      if (!password) throw new HttpError('Enter the password first.');
      return listFolders(acct, acct.host.includes('gmail') ? password.replace(/\s+/g, '') : password);
    },
    // Which of the latest mails would a rule have matched? Read-only.
    'POST /api/email/preview': async (body) => {
      const t = emailTracker(body.id);
      const password = emailPassword(t);
      if (!password) throw new HttpError('No password saved for this account.');
      const rule = compileRule(formToRule(body.rule));
      if (!isUsable(rule)) return { usable: false, mails: [] };
      const mails = await previewMail({ ...t, folder: body.folder || t.folders[0] }, password, Math.min(Number(body.limit) || 50, 100));
      return { usable: true, mails: mails.map((m) => ({ from: m.fromName || m.fromAddress, address: m.fromAddress, subject: m.subject, date: m.date, size: m.size, attachments: m.attachments.map((a) => a.name || a.type), matched: matchesMail(rule, m) })) };
    },
    'POST /api/tracker': async (body) => {
      const msg = body.action === 'start' ? startTracker(ctx)
        : body.action === 'stop' ? stopTracker(ctx)
        : body.action === 'restart' ? await restartTracker(ctx) : (() => { throw new HttpError('unknown action'); })();
      return { message: msg };
    },
    'POST /api/run-at-login': (body) => {
      if (profile) throw new HttpError('Not available in a test profile.');
      if (body.enabled) {
        stopTracker(ctx); // the service starts its own copy
        return { message: manageService('install', { args: serviceArgs, dataDir }).trim() };
      }
      return { message: manageService('uninstall', { args: serviceArgs, dataDir }).trim() };
    },
    'GET /api/log': () => ({ text: tailLog(dataDir) }),
    // The QR carries the app's address plus which computer this is, so the app can name it when scanned.
    'GET /api/devices': () => {
      const { app } = parseConfig(readFileSync(configFile, 'utf8'));
      const me = computerIdentity(dataDir);
      const link = `${app}#c=${me.id}&n=${encodeURIComponent(me.name)}`;
      return { app, qr: qrSvg(link), computer: me.name, devices: listDevices(dataDir).map(publicDevice) };
    },
    'PUT /api/computer': (body) => ({ computer: setComputerName(dataDir, body.name).name }),
    'POST /api/devices': async (body) => ({ device: await pairDevice(dataDir, body.code) }),
    'POST /api/devices/remove': (body) => {
      if (!removeDevice(dataDir, String(body.id ?? ''))) throw new HttpError('That device is not paired.');
      return {};
    },
    'POST /api/notify/test': async (body) => {
      const method = body.method;
      if (!['desktop', 'devices'].includes(method)) throw new HttpError('unknown method');
      if (method === 'devices' && body.device) {
        const hit = listDevices(dataDir).find((p) => p.id === body.device);
        if (!hit) throw new HttpError('That device is no longer paired.');
        try { await pushToDevices(dataDir, { t: 'test', title: 'whatsgrep test', body: 'If you can read this, notifications work.', at: Date.now() }, { only: hit.id }); } catch (e) { throw new HttpError(e.message); }
        return {};
      }
      const errors = [];
      const orig = console.error;
      console.error = (m) => errors.push(String(m));
      try {
        await notify([method], { rule: 'test', dataDir, title: 'whatsgrep test', message: 'If you can read this, notifications work.', priority: 'default' });
      } finally { console.error = orig; }
      if (errors.length) throw new HttpError(errors[0].replace(/^\[test\] /, ''));
      return {};
    },
  };

  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:" });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const authorized = (req) => {
    const got = Buffer.from(String(req.headers['x-token'] ?? ''));
    const want = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  };

  const server = createServer(async (req, res) => {
    try {
      // Only reachable as localhost, and only from our own page (blocks DNS rebinding and cross-site requests).
      if (req.headers.host !== origin.slice('http://'.length) && req.headers.host !== origin.slice('http://'.length).replace('127.0.0.1', 'localhost')) return send(res, 403, { error: 'forbidden host' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, await pageHtml(), 'text/html');
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (!authorized(req)) return send(res, 401, { error: 'bad token' });
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== origin && req.headers.origin !== origin.replace('127.0.0.1', 'localhost')) return send(res, 403, { error: 'forbidden origin' });
      if (url.pathname === '/api/qr.svg') {
        const sts = readStatus(dataDir);
        const qr = sts?.trackers?.find((x) => x.id === (url.searchParams.get('tracker') ?? whatsappTracker().id))?.qr;
        return qr ? send(res, 200, qrSvg(qr), 'image/svg+xml') : send(res, 404, { error: 'no QR right now' });
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(res, 404, { error: 'not found' });
      let body = {};
      if (req.method !== 'GET') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw new HttpError('too large', 413); }
        body = raw ? JSON.parse(raw) : {};
      }
      send(res, 200, (await handler(body, url.searchParams)) ?? {});
    } catch (e) {
      send(res, e.status ?? 400, { error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, url: `${origin}/?t=${token}` });
    });
  });
}
