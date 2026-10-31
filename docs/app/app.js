'use strict';

// The whatsgrep phone app. It makes this phone's push address, shows a code to paste into
// whatsgrep on the computer, and lists the alerts that arrive. Alerts are encrypted on the
// computer and only this phone can read them; this page hosts no server and holds no account.

const ICONS = {
  mark: '<path d="M4 20l1.4-4.2A8 8 0 1 1 8.4 18.7z"/><path d="M9 10h6M9 13h4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18h2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  chat: '<path d="M4 20l1.4-4.2A8 8 0 1 1 8.4 18.7z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
};
const icon = (name, size = 20) => {
  const s = document.createElement('span');
  s.className = 'ico';
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name]}</svg>`;
  return s;
};

// Builds elements without ever putting alert text through innerHTML.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
const $ = (s) => document.querySelector(s);

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const deviceName = () => (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : 'Phone');

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

const st = { tab: 'alerts', enabled: false, paired: false, stale: false, code: '', alerts: [], error: '', busy: false, open: new Set(), confirmClear: false };

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// ---- this phone's push address ------------------------------------------------------------

async function load() {
  const [code, paired, stale] = await Promise.all([WG.get('code'), WG.get('paired'), WG.get('stale')]);
  st.alerts = await WG.list();
  st.code = code || '';
  st.paired = !!paired;
  st.stale = !!stale;
  let sub = null;
  if (canPush && 'serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    sub = reg ? await reg.pushManager.getSubscription() : null;
  }
  st.enabled = !!(code && sub && Notification.permission === 'granted');
}

// Turns alerts on: asks permission, makes a key only this phone and the computer will share, and
// subscribes the browser's push service to it. The code carries everything the computer needs.
async function enable() {
  st.busy = true; st.error = '';
  render();
  try {
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked. Allow them for this app in your phone settings.');
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicKey = Uint8Array.from([4, ...unb64url(jwk.x), ...unb64url(jwk.y)]);
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    const keys = sub.toJSON().keys;
    const code = 'wg1.' + b64url(new TextEncoder().encode(JSON.stringify({ e: sub.endpoint, p: keys.p256dh, a: keys.auth, d: jwk.d, n: deviceName() })));
    await WG.set('code', code);
    await WG.set('paired', false);
    await WG.del('stale');
    st.tab = 'pair';
    await load();
  } catch (e) {
    st.error = e.name === 'NotAllowedError' ? 'Notifications are blocked. Allow them for this app in your phone settings.' : e.message || String(e);
  }
  st.busy = false;
  render();
}

async function disable() {
  const reg = await navigator.serviceWorker.getRegistration();
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  await Promise.all([WG.del('code'), WG.del('paired'), WG.del('stale')]);
  st.tab = 'alerts';
  await load();
  render();
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch {
    const pre = $('.code');
    if (pre) { const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); }
    toast('Press and hold to copy');
  }
}

// ---- screens ------------------------------------------------------------------------------

function hero(name, title, ...rest) {
  return h('div', { class: 'hero' }, h('span', { class: 'bigicon' + (name === 'alert' ? ' bad' : '') }, icon(name, 34)), h('h1', {}, title), ...rest);
}

const installScreen = () => [
  hero('phone', 'Add to Home Screen'),
  h('div', { class: 'card' }, h('ol', { class: 'steps' },
    h('li', {}, h('span', { class: 'n' }, icon('share')), 'Tap Share'),
    h('li', {}, h('span', { class: 'n' }, icon('plus')), 'Add to Home Screen'),
    h('li', {}, h('span', { class: 'n' }, icon('mark')), 'Open whatsgrep from there'))),
];

const unsupportedScreen = () => [hero('alert', 'This browser cannot get alerts', h('p', {}, 'Use Chrome on Android, or Safari on iPhone (iOS 16.4 or later).'))];

const welcomeScreen = () => [
  hero('bell', 'Alerts on this phone', h('p', {}, 'Encrypted on your computer. Only this phone can read them.'),
    h('button', { class: 'btn primary', disabled: st.busy, onclick: enable }, icon('power'), st.busy ? 'Turning on…' : 'Turn on alerts'),
    st.error && h('p', { class: 'hint err' }, st.error)),
];

const pairScreen = () => [
  h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:14px' },
    st.stale
      ? h('div', { class: 'state' }, icon('alert'), 'This phone needs a new code')
      : st.paired
        ? h('div', { class: 'state' }, icon('check'), 'Connected to your computer')
        : h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Waiting for your computer'),
    h('pre', { class: 'code' }, st.code),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => copy(st.code) }, icon('copy'), 'Copy code'),
      navigator.share && h('button', { class: 'btn', onclick: () => navigator.share({ text: st.code }).catch(() => {}) }, icon('share'), 'Share')),
    h('p', { class: 'hint' }, 'Paste it in whatsgrep on your computer: Delivery, then Add phone. Keep it private.')),
  h('div', { class: 'row center' }, h('button', { class: 'btn ghost danger', onclick: disable }, icon('power'), 'Turn off alerts')),
];

function alertCard(a, i) {
  const open = st.open.has(i);
  return h('button', { class: 'alert' + (open ? ' open' : ''), onclick: () => { open ? st.open.delete(i) : st.open.add(i); render(); } },
    h('div', { class: 't' }, h('b', {}, a.title || a.rule || 'Alert'), h('time', {}, ago(a.at))),
    a.body && h('p', {}, a.body),
    a.tracker && h('span', { class: 'src' }, icon(/mail|gmail|outlook|yahoo|icloud/i.test(a.tracker) ? 'mail' : 'chat', 14), a.tracker));
}

const alertsScreen = () => st.alerts.length
  ? [...st.alerts.map(alertCard),
      h('div', { class: 'row center' }, st.confirmClear
        ? [h('button', { class: 'btn danger', onclick: async () => { await WG.clear(); st.alerts = []; st.confirmClear = false; render(); } }, icon('trash'), 'Clear all'), h('button', { class: 'btn ghost', onclick: () => { st.confirmClear = false; render(); } }, 'Keep')]
        : h('button', { class: 'btn ghost', onclick: () => { st.confirmClear = true; render(); } }, icon('trash'), 'Clear'))]
  : [h('div', { class: 'empty' }, h('span', { class: 'bigicon' }, icon('bell', 30)), h('b', {}, 'No alerts yet'))];

// ---- page ---------------------------------------------------------------------------------

function render() {
  const mark = $('#mark');
  if (!mark.firstChild) mark.append(icon('mark', 18));

  const needsInstall = isIOS && !standalone;
  const ready = canPush && !needsInstall && st.enabled;

  const tabs = $('#tabs');
  tabs.hidden = !ready;
  if (ready) {
    const [a, p] = tabs.querySelectorAll('button');
    a.replaceChildren(icon('bell'), 'Alerts');
    p.replaceChildren(icon('qr'), 'Pair');
    for (const b of [a, p]) {
      b.classList.toggle('on', b.dataset.tab === st.tab);
      b.onclick = () => { st.tab = b.dataset.tab; render(); };
    }
  }

  const status = $('#status');
  status.hidden = !ready;
  if (ready) {
    status.className = 'tstatus ' + (st.stale ? 'bad' : st.paired ? 'ok' : 'warn');
    $('#statustext').textContent = st.stale ? 'Needs a new code' : st.paired ? 'Connected' : 'Not paired';
  }

  $('#main').replaceChildren(...(needsInstall ? installScreen() : !canPush ? unsupportedScreen() : !st.enabled ? welcomeScreen() : st.tab === 'pair' ? pairScreen() : alertsScreen()));
}

async function start() {
  if (canPush) await navigator.serviceWorker.register('sw.js').catch(() => {});
  await load().catch(() => {});
  render();
  if (!canPush) return;
  navigator.serviceWorker.addEventListener('message', async (e) => {
    await load();
    if (e.data?.t === 'paired') { toast('Connected to your computer'); st.tab = 'alerts'; }
    render();
  });
  document.addEventListener('visibilitychange', async () => { if (!document.hidden) { await load().catch(() => {}); render(); } });
  setInterval(render, 60000); // keeps "5m" fresh
}

start();
