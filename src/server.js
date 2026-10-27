import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { isScalar, parseDocument, visit } from 'yaml';
import { findBrowser } from './browser.js';
import { parseConfig } from './config.js';
import { startTracker, stopTracker, tailLog } from './control.js';
import { compileRule, matchesChat, matchesMessage, isUsable } from './matcher.js';
import { notify } from './notify.js';
import { qrSvg } from './qrsvg.js';
import { formToRule, ruleToForm } from './ruleform.js';
import { getAsset } from './sea.js';
import { isServiceInstalled, manageService } from './service.js';
import { clearAccount, clearMatches, readAccount, readChats, readMatches, readStatus, sendCommand } from './status.js';
import { savedTopic, forgetTopic, randomTopic, saveTopic } from './state.js';
import { storeName } from './secrets.js';
import { exampleText } from './commands.js';
import { VERSION } from './version.js';

const PRIORITIES = ['min', 'low', 'default', 'high', 'urgent'];

const pageHtml = () => getAsset('ui.html') ?? readFileSync(new URL('./ui/index.html', import.meta.url), 'utf8');

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

// Applies UI settings to the YAML document, keeping its comments and untouched rules as written.
function applySettings(doc, body) {
  if (body.notifications !== undefined && !body.notifications.length) throw new HttpError('Keep at least one notification type on.');
  if (body.notifications !== undefined) doc.set('notifications', doc.createNode(body.notifications));
  if (body.ntfyServer !== undefined) doc.setIn(['ntfy', 'server'], String(body.ntfyServer).trim());
  if (body.repeatWindowHours !== undefined) doc.setIn(['settings', 'repeat_window_hours'], Number(body.repeatWindowHours));
  if (body.browser !== undefined) {
    if (String(body.browser).trim()) doc.set('browser', String(body.browser).trim());
    else doc.delete('browser');
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
export const API_VERSION = 4;

export function startServer(ctx, { port = 0 } = {}) {
  const { configFile, dataDir, serviceArgs } = ctx;
  const token = randomBytes(18).toString('base64url');
  let origin;

  const loadState = () => {
    let config = null;
    let rules = [];
    let configError;
    if (existsSync(configFile)) {
      try {
        const doc = readDoc(configFile).toJSON() ?? {};
        const parsed = parseConfig(readFileSync(configFile, 'utf8'));
        config = { notifications: parsed.methods, ntfyServer: parsed.server, repeatWindowHours: parsed.repeatWindowMs / 3600e3, browser: parsed.browser ?? '' };
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
      configFile, dataDir,
      configExists: existsSync(configFile),
      configError,
      config, rules,
      status: readStatus(dataDir) ?? null,
      recentMatches: readMatches(dataDir, 20),
      matchTotal: readMatches(dataDir).length,
      whatsapp: { account: readAccount(dataDir) ?? null, hasSession: existsSync(join(dataDir, 'auth')) },
      runAtLogin: isServiceInstalled(),
      browserFound: browser,
      priorities: PRIORITIES,
      keychain: storeName(),
    };
  };

  const routes = {
    'GET /api/state': () => loadState(),
    'POST /api/config/init': () => {
      if (!existsSync(configFile)) { mkdirSync(dirname(configFile), { recursive: true }); writeFileSync(configFile, exampleText()); }
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
    'POST /api/rule/test': (body) => {
      const raw = formToRule(body.rule);
      const rule = compileRule(raw);
      if (!isUsable(rule)) return { usable: false, matched: false };
      const chat = matchesChat(rule, [body.chat ?? '']);
      const message = matchesMessage(rule, String(body.text ?? ''));
      return { usable: true, chat, message, matched: chat && message };
    },
    'GET /api/notifications': () => ({ items: readMatches(dataDir) }),
    'POST /api/notifications/clear': () => { clearMatches(dataDir); return {}; },
    'GET /api/chats': () => {
      const st = readStatus(dataDir);
      return { ...readChats(dataDir), running: !!st?.running, linked: !!(st?.running && st.account) };
    },
    'POST /api/chats/refresh': () => {
      if (!readStatus(dataDir)?.running) return { running: false };
      sendCommand(dataDir, 'chats');
      return { running: true };
    },
    'POST /api/whatsapp/check': () => {
      if (!readStatus(dataDir)?.running) return { running: false };
      sendCommand(dataDir, 'check');
      return { running: true };
    },
    'POST /api/whatsapp/logout': () => {
      if (readStatus(dataDir)?.running) { sendCommand(dataDir, 'logout'); return { message: 'Logging out…' }; }
      // Tracker is stopped: only the saved session on this computer can be removed.
      rmSync(join(dataDir, 'auth'), { recursive: true, force: true });
      clearAccount(dataDir);
      return { message: 'Removed the saved session. Also remove “whatsgrep” under Linked devices on your phone if it is still listed.' };
    },
    'POST /api/tracker': (body) => {
      const msg = body.action === 'start' ? startTracker(ctx)
        : body.action === 'stop' ? stopTracker(ctx)
        : body.action === 'restart' ? (stopTracker(ctx), startTracker(ctx)) : (() => { throw new HttpError('unknown action'); })();
      return { message: msg };
    },
    'POST /api/run-at-login': (body) => {
      if (body.enabled) {
        stopTracker(ctx); // the service starts its own copy
        return { message: manageService('install', { args: serviceArgs, dataDir }).trim() };
      }
      return { message: manageService('uninstall', { args: serviceArgs, dataDir }).trim() };
    },
    'GET /api/log': () => ({ text: tailLog(dataDir) }),
    'GET /api/ntfy': () => {
      const cfg = parseConfig(readFileSync(configFile, 'utf8'));
      const t = savedTopic(dataDir);
      return { server: cfg.server, topic: t?.topic ?? '', store: t?.store };
    },
    'POST /api/ntfy/generate': () => ({ topic: randomTopic() }),
    'PUT /api/ntfy/topic': (body) => { saveTopic(dataDir, String(body.topic ?? '').trim()); return {}; },
    // QR + links for a (possibly not yet saved) server and topic.
    'POST /api/ntfy/qr': (body) => {
      let u;
      try { u = new URL(String(body.server)); } catch { throw new HttpError('That ntfy server is not a valid URL.'); }
      const topic = String(body.topic ?? '');
      const deepLink = `ntfy://${u.host}/${topic}${u.protocol === 'http:' ? '?secure=false' : ''}`;
      return { url: `${String(body.server).replace(/\/+$/, '')}/${topic}`, deepLink, svg: qrSvg(deepLink) };
    },
    'POST /api/ntfy/forget': () => { forgetTopic(); return {}; },
    'POST /api/notify/test': async (body) => {
      const cfg = parseConfig(readFileSync(configFile, 'utf8'));
      const method = body.method;
      if (!['desktop', 'ntfy'].includes(method)) throw new HttpError('unknown method');
      const t = savedTopic(dataDir);
      if (method === 'ntfy' && !t) throw new HttpError('No ntfy topic yet. Start the tracker once so one is created.');
      const errors = [];
      const orig = console.error;
      console.error = (m) => errors.push(String(m));
      try {
        await notify([method], { rule: 'test', server: cfg.server, topic: t?.topic, title: 'whatsgrep test', message: 'If you can read this, notifications work.', priority: 'default' });
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
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, pageHtml(), 'text/html');
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (!authorized(req)) return send(res, 401, { error: 'bad token' });
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== origin && req.headers.origin !== origin.replace('127.0.0.1', 'localhost')) return send(res, 403, { error: 'forbidden origin' });
      if (url.pathname === '/api/qr.svg') {
        const qr = readStatus(dataDir)?.qr;
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
      send(res, 200, (await handler(body)) ?? {});
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
