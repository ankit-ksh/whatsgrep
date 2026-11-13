import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { findBrowser, releaseProfile } from '../system/browser.js';
import { matches } from '../core/rule.js';
import { isPackaged } from '../core/sea.js';
import { clearAccount, writeAccount, writeChats } from '../core/status.js';

const BACKOFF = [5000, 15000, 60000, 300000];
const LOGIN_WINDOW = 5 * 60e3; // after "Link", QR codes are shown for this long

// WhatsApp through WhatsApp Web in a hidden browser. Needs a QR scan once; the session is kept in
// this tracker's folder. A lost connection is retried here without disturbing other trackers.
export function createWhatsApp(def, env) {
  let client;
  let stopped = true;
  let timer;
  let attempt = 0;
  let loginUntil = 0;
  let qrLines = 0;
  const chatInfo = new Map();
  let warnedChat = false;
  let releasedOnce = false;
  let launching = false;
  let qrGrace;

  const dropClient = async () => {
    clearTimeout(qrGrace); qrGrace = undefined;
    const c = client;
    client = undefined;
    await c?.destroy().catch(() => {});
  };

  async function needsLogin(why) {
    await dropClient();
    delete env.entry.qr;
    env.set('needs login', { error: why });
    env.log(why ?? 'Needs to be linked.');
  }

  function retryLater(why) {
    if (stopped) return;
    env.set('reconnecting', { error: why });
    env.warn(`${why} Trying again shortly.`);
    dropClient().then(() => {
      timer = setTimeout(launch, BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
    });
  }

  // chat id -> { name, phone }. wwebjs's getChat()/getChats() throw "r: r" on some WhatsApp
  // Web versions, so read from WhatsApp's in-page collections directly. Newer WhatsApp uses
  // anonymous "@lid" ids for chats; resolve those to the real phone number when known.
  async function chatInfoOf(id) {
    if (chatInfo.has(id)) return chatInfo.get(id);
    try {
      const info = await client.pupPage.evaluate((cid) => {
        const wid = window.require('WAWebWidFactory').createWid(cid);
        const chat = window.require('WAWebCollections').Chat.get(wid);
        let phone = '';
        try {
          const p = wid.server === 'lid' ? window.require('WAWebApiContact').getPhoneNumber(wid) : wid;
          phone = p?.user ?? '';
        } catch {}
        return { name: chat ? (chat.formattedTitle || chat.name || '') : '', phone };
      }, id);
      if (info.name || info.phone) chatInfo.set(id, info);
      return info;
    } catch (e) {
      if (!warnedChat) { warnedChat = true; env.warn(`could not read chat info (${e.message}); chats can still be matched by id, see --verbose`); }
      return { name: '', phone: '' };
    }
  }

  async function exportChats() {
    try {
      const chats = await client.pupPage.evaluate(() => {
        const col = window.require('WAWebCollections').Chat;
        const models = col.getModelsArray ? col.getModelsArray() : col.models;
        return models.slice(0, 1500).map((c) => {
          let phone = '';
          try {
            const wid = c.id;
            const p = wid.server === 'lid' ? window.require('WAWebApiContact').getPhoneNumber(wid) : wid;
            if (!c.isGroup) phone = p?.user ?? '';
          } catch {}
          return { id: c.id._serialized, name: c.formattedTitle || c.name || '', group: !!c.isGroup, phone, t: c.t || 0 };
        });
      });
      writeChats(env.dir, chats.sort((a, b) => b.t - a.t));
    } catch (e) { env.warn(`could not read the chat list: ${e.message}`); }
  }

  function wire(c) {
    c.on('qr', async (qr) => {
      // Under a service nobody can scan: wait until someone asks to link instead of asking WhatsApp for logins forever.
      if (!env.tty && Date.now() > loginUntil) {
        // A saved session can show a code for a moment while it is still being restored. Closing the
        // browser then could damage it, so give it time before deciding it is not linked.
        if (existsSync(join(env.dir, 'auth', 'session'))) {
          if (!qrGrace) {
            env.log('WhatsApp showed a login code while restoring the saved session. Waiting before giving up.');
            const c = client;
            qrGrace = setTimeout(() => { qrGrace = undefined; if (client === c && c.info === undefined) void needsLogin('Not linked to WhatsApp. Choose "Link" in the interface, or run `whatsgrep` once in a terminal.'); }, 45000);
          }
          return;
        }
        return needsLogin('Not linked to WhatsApp. Choose "Link" in the interface, or run `whatsgrep` once in a terminal.');
      }
      env.entry.qr = qr;
      env.set('waiting for QR scan');
      if (env.tty) {
        const { default: qrcode } = await import('qrcode-terminal');
        qrcode.generate(qr, { small: true }, (art) => {
          const block = `Scan this QR with WhatsApp > Linked devices (it refreshes every ~20s):\n${art}`;
          if (qrLines) process.stdout.write(`\x1b[${qrLines}A\x1b[0J`);
          console.log(block);
          qrLines = block.split('\n').length;
        });
      }
    });
    c.on('authenticated', () => { clearTimeout(qrGrace); qrGrace = undefined; qrLines = 0; delete env.entry.qr; env.set('linking'); });
    c.on('auth_failure', (m) => needsLogin(`WhatsApp login failed: ${m}.`));
    c.on('change_state', (state) => env.log(`WhatsApp connection state: ${state}`));
    c.on('disconnected', (reason) => {
      env.warn(`WhatsApp disconnected, reason: ${reason}`);
      if (String(reason).toUpperCase() === 'LOGOUT') { clearAccount(env.dir); delete env.entry.account; needsLogin('WhatsApp ended this link (reason: LOGOUT). If you did not remove it on the phone under Linked devices, link again.'); }
      else retryLater(`Disconnected from WhatsApp (${reason}).`);
    });
    c.on('ready', () => {
      clearTimeout(qrGrace); qrGrace = undefined;
      attempt = 0;
      releasedOnce = false;
      loginUntil = 0;
      env.entry.account = { number: c.info?.wid?.user ?? '', name: c.info?.pushname ?? '' };
      env.entry.waState = 'CONNECTED';
      env.entry.checkedAt = Date.now();
      writeAccount(env.dir, env.entry.account);
      delete env.entry.qr;
      setTimeout(() => { if (client === c) exportChats(); }, 8000);
      env.set('listening');
      c.pupBrowser?.on('disconnected', () => { if (client === c) retryLater('The browser closed unexpectedly.'); });
      env.log(`Listening${env.opt['dry-run'] ? ' (dry run)' : ''}`);
    });
    // message_create also fires for messages you send, which 'message' skips.
    c.on('message_create', async (msg) => {
      try {
        // Own messages are ignored, except in your "Message yourself" chat (handy for testing).
        if ((msg.fromMe && msg.to !== msg.from) || msg.isStatus || !msg.body) return;
        const chatId = msg.fromMe ? msg.to : msg.from;
        const { name: chatName, phone } = await chatInfoOf(chatId);
        const keys = [chatName, chatId, phone && `${phone}@c.us`];
        if (env.opt.verbose) {
          const lag = Math.round(Date.now() / 1000 - msg.timestamp);
          console.log(`  [${chatName || '?'} | ${chatId}${phone ? ` | +${phone}` : ''}] (${lag}s after sent) ${msg.body}`);
        }
        await env.handle({
          chat: chatName || 'chat',
          text: msg.body,
          key: `${msg.author ?? msg.from}|${msg.body}`,
          title: (rule) => `${rule.name} · ${chatName || 'chat'}`,
          body: msg.body,
          match: (rule) => matches(rule, msg.body, keys),
        });
      } catch (e) {
        env.error(`message handling failed: ${e.message}`);
      }
    });
  }

  async function launch() {
    clearTimeout(timer);
    // One browser at a time: a second start while one is opening would fight it over the profile.
    if (stopped || launching) return;
    launching = true;
    try { await launchOnce(); } finally { launching = false; }
  }

  async function launchOnce() {
    if (!existsSync(join(env.dir, 'auth')) && !env.tty && Date.now() > loginUntil) return needsLogin('Not linked to WhatsApp. Choose "Link" in the interface, or run `whatsgrep` once in a terminal.');
    env.set('starting');
    let browserPath;
    try {
      // Prefer the real browser installed on this machine. Without one a packaged build can't run;
      // from source, puppeteer falls back to the Chromium it downloaded.
      browserPath = findBrowser({ override: env.opt.browser ?? env.browser });
    } catch (e) { return env.set('error', { error: e.message }); }
    if (!browserPath && isPackaged()) return env.set('error', { error: 'No Chrome, Chromium, Edge or Brave found. Install one, or point to it with --browser <path> (or WHATSGREP_BROWSER).' });
    if (browserPath) env.log(`Browser: ${browserPath}`);
    try {
      const { default: wweb } = await import('whatsapp-web.js');
      const { Client, LocalAuth } = wweb;
      const c = new Client({
        authStrategy: new LocalAuth({ dataPath: join(env.dir, 'auth') }),
        puppeteer: { headless: true, args: ['--no-sandbox'], executablePath: browserPath },
      });
      client = c;
      wire(c);
      await c.initialize();
    } catch (e) {
      // An old browser still holding this profile: stop it and try once more right away.
      if (!stopped && /already running/i.test(e.message) && !releasedOnce) {
        releasedOnce = true;
        await dropClient();
        if (releaseProfile(join(env.dir, 'auth', 'session'))) { env.log('Stopped a browser left over from an earlier run.'); return launch(); }
      }
      if (!stopped && client) retryLater(`Could not start WhatsApp: ${e.message}`);
    }
  }

  return {
    async start() { stopped = false; await launch(); },
    async stop() { stopped = true; clearTimeout(timer); await dropClient(); },
    async command(action) {
      if (action === 'login') {
        loginUntil = Date.now() + LOGIN_WINDOW;
        if (!client && !stopped) await launch();
      } else if (!client) {
        return;
      } else if (action === 'check') {
        try { env.entry.waState = await client.getState(); } catch (e) { env.entry.waState = `ERROR ${e.message}`; }
        env.entry.checkedAt = Date.now();
        env.publish();
      } else if (action === 'chats') {
        await exportChats();
      } else if (action === 'logout') {
        try { await client.logout(); } catch (e) { env.warn(`logout: ${e.message}`); }
        await dropClient();
        rmSync(join(env.dir, 'auth'), { recursive: true, force: true });
        clearAccount(env.dir);
        delete env.entry.account;
        await needsLogin('Logged out of WhatsApp.');
      }
    },
  };
}
