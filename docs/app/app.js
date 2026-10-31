'use strict';

// The whatsgrep app. One page for every device: it works out what this device is (phone, tablet or
// laptop) and words itself to match. It makes this device's push address, shows a code to paste
// into whatsgrep on the computer, and lists the alerts that arrive. Alerts are encrypted on the
// computer and only this device can read them; this page hosts no server and holds no account.

const ICONS = {
  mark: '<path d="M4 20l1.4-4.2A8 8 0 1 1 8.4 18.7z"/><path d="M9 10h6M9 13h4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
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
  left: '<path d="m15 18-6-6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
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
    if (v === undefined || v === false || v === null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
const $ = (s) => document.querySelector(s);

// ---- what this device is -------------------------------------------------------------------

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// What to call this device in the words on screen.
const noun = /iPhone|iPod/.test(ua) || (isAndroid && /Mobile/.test(ua)) ? 'phone' : /iPad/.test(ua) || isAndroid || (isIOS && !/iPhone/.test(ua)) ? 'tablet' : 'device';

async function deviceName() {
  try {
    const model = (await navigator.userAgentData?.getHighEntropyValues(['model']))?.model;
    if (model) return model;
  } catch { /* not offered by this browser */ }
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (isIOS && noun === 'tablet')) return 'iPad';
  if (isAndroid) return noun === 'phone' ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(ua)) return 'Windows laptop';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Linux|X11/.test(ua)) return 'Linux laptop';
  return 'Device';
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

const st = {
  tab: 'alerts', view: 'tabs', enabled: false, paired: false, stale: false,
  pair: null, name: '', computers: [], alerts: [], seenAt: 0, adding: null,
  error: '', busy: false, open: new Set(), confirmClear: false, installEvt: null,
};

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

// ---- this device's push address ------------------------------------------------------------

const codeOf = () => 'wg1.' + b64url(new TextEncoder().encode(JSON.stringify({ e: st.pair.e, p: st.pair.p, a: st.pair.a, d: st.pair.d, n: st.name })));

// An earlier version kept only the code. Read the pieces back out of it.
function pairFromCode(code) {
  try { const c = JSON.parse(new TextDecoder().decode(unb64url(code.slice(4)))); return { pair: { e: c.e, p: c.p, a: c.a, d: c.d }, name: c.n || '' }; } catch { return null; }
}

async function load() {
  const [pair, code, name, paired, stale, computers, seenAt] = await Promise.all([WG.get('pair'), WG.get('code'), WG.get('name'), WG.get('paired'), WG.get('stale'), WG.get('computers'), WG.get('seenAt')]);
  const old = !pair && code ? pairFromCode(code) : null;
  st.pair = pair || old?.pair || null;
  st.name = name || old?.name || (st.pair ? await deviceName() : '');
  st.paired = !!paired;
  st.stale = !!stale;
  st.computers = computers || [];
  st.seenAt = seenAt || 0;
  st.alerts = await WG.list();
  let sub = null;
  if (canPush) {
    const reg = await navigator.serviceWorker.getRegistration();
    sub = reg ? await reg.pushManager.getSubscription() : null;
  }
  st.enabled = !!(st.pair && sub && Notification.permission === 'granted');
}

// Turns alerts on: asks permission, makes a key only this device and the computer will share, and
// subscribes the browser's push service to it. The code carries everything the computer needs.
async function enable() {
  st.busy = true; st.error = '';
  render();
  try {
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked. Allow them for this app in your settings.');
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicKey = Uint8Array.from([4, ...unb64url(jwk.x), ...unb64url(jwk.y)]);
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    const keys = sub.toJSON().keys;
    await WG.set('pair', { e: sub.endpoint, p: keys.p256dh, a: keys.auth, d: jwk.d });
    await WG.set('name', await deviceName());
    await WG.set('paired', false);
    await WG.del('stale');
    await WG.del('code');
    st.tab = 'computers';
    st.view = 'tabs';
    await load();
    // opened from a scanned link before alerts were on: now the computer it named can be added
    const waiting = await WG.get('pendingComputer');
    if (waiting) { await WG.del('pendingComputer'); await addComputer(waiting); }
  } catch (e) {
    st.error = e.name === 'NotAllowedError' ? 'Notifications are blocked. Allow them for this app in your settings.' : e.message || String(e);
  }
  st.busy = false;
  render();
}

async function disable() {
  const reg = await navigator.serviceWorker.getRegistration();
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  await Promise.all(['pair', 'code', 'paired', 'stale', 'computers', 'seenAt', 'pendingComputer'].map((k) => WG.del(k)));
  st.tab = 'alerts'; st.view = 'tabs'; st.adding = null;
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

async function markSeen() {
  if (st.tab !== 'alerts' || st.view !== 'tabs' || document.hidden || !st.alerts.length) return;
  const newest = Math.max(...st.alerts.map((a) => a.got || a.at || 0));
  if (newest > st.seenAt) { st.seenAt = newest; await WG.set('seenAt', newest); }
}
const unread = () => st.alerts.filter((a) => (a.got || a.at || 0) > st.seenAt).length;

// ---- computers -----------------------------------------------------------------------------

async function addComputer(c) {
  const list = (await WG.get('computers')) || [];
  const known = list.find((x) => x.id === c.id);
  if (known) known.name = c.name || known.name;
  else list.push({ id: c.id, name: c.name || 'Computer', paired: false, addedAt: Date.now() });
  await WG.set('computers', list);
  st.computers = list;
  st.adding = c.id;
  st.view = 'add';
  st.tab = 'computers';
}

// A scanned QR (or a link opened from the camera) says which computer it is: #c=<id>&n=<name>.
function parseLink(text) {
  try {
    const q = new URLSearchParams(new URL(text).hash.slice(1));
    const id = q.get('c');
    return id && /^[\w-]{3,32}$/.test(id) ? { id, name: (q.get('n') || '').slice(0, 40) } : null;
  } catch { return null; }
}

let scanning = null;
const loadJsQR = () => (window.jsQR ? Promise.resolve() : new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'vendor/jsQR.js'; s.onload = ok; s.onerror = fail; document.head.append(s); }));

function stopScan() {
  if (scanning) { clearTimeout(scanning.timer); scanning.stream?.getTracks().forEach((t) => t.stop()); scanning = null; }
  $('#video').srcObject = null;
  $('#scan').hidden = true;
}

async function startScan() {
  const msg = $('#scanmsg');
  $('#scan').hidden = false;
  msg.textContent = `Point the camera at the QR code on your computer`;
  const me = { stopped: false };
  scanning = me;
  try {
    await loadJsQR();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (scanning !== me) { stream.getTracks().forEach((t) => t.stop()); return; }
    me.stream = stream;
    const video = $('#video');
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const decode = window.jsQR.default || window.jsQR;
    const tick = async () => {
      if (scanning !== me) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const w = Math.min(640, video.videoWidth);
        const hh = Math.round((video.videoHeight * w) / video.videoWidth);
        canvas.width = w; canvas.height = hh;
        ctx.drawImage(video, 0, 0, w, hh);
        const r = decode(ctx.getImageData(0, 0, w, hh).data, w, hh, { inversionAttempts: 'dontInvert' });
        if (r) {
          const c = parseLink(r.data);
          if (c) { stopScan(); await addComputer(c); render(); return; }
          msg.textContent = 'That is not a whatsgrep code. Try the one on your computer.';
        }
      }
      me.timer = setTimeout(tick, 120);
    };
    tick();
  } catch (e) {
    if (scanning === me) msg.textContent = e.name === 'NotAllowedError' ? 'The camera is blocked. Allow it in your settings, or use the code instead.' : 'Could not open the camera. Use the code instead.';
  }
}

// ---- screens -------------------------------------------------------------------------------

const hero = (name, title, ...rest) => h('div', { class: 'hero' }, h('span', { class: 'bigicon' + (name === 'alert' ? ' bad' : '') }, icon(name, 34)), h('h1', {}, title), ...rest);

const installScreen = () => [
  hero('phone', 'Add to Home Screen', h('p', {}, `iPhone and iPad only allow alerts for apps on the Home Screen.`)),
  h('div', { class: 'card' }, h('ol', { class: 'steps' },
    h('li', {}, h('span', { class: 'n' }, icon('share')), 'Tap Share'),
    h('li', {}, h('span', { class: 'n' }, icon('plus')), 'Add to Home Screen'),
    h('li', {}, h('span', { class: 'n' }, icon('mark')), 'Open whatsgrep from there'))),
];

const unsupportedScreen = () => [hero('alert', 'This browser cannot get alerts', h('p', {}, isIOS ? 'This needs iOS 16.4 or later.' : 'Use Chrome, Edge or Firefox, or Safari 16 on a Mac.'))];

const welcomeScreen = () => [
  hero('bell', `Alerts on this ${noun}`,
    h('p', {}, `Encrypted on your computer. Only this ${noun} can read them.`),
    h('button', { class: 'btn primary', disabled: st.busy, onclick: enable }, icon('power'), st.busy ? 'Turning on…' : 'Turn on alerts'),
    st.installEvt && !standalone && h('button', { class: 'btn ghost', onclick: async () => { st.installEvt.prompt(); st.installEvt = null; render(); } }, icon('download'), 'Install app'),
    noun === 'device' && h('p', { class: 'hint' }, 'Alerts arrive while this browser is open.'),
    st.error && h('p', { class: 'hint err' }, st.error)),
];

const alertCard = (a, i) => {
  const open = st.open.has(i);
  return h('button', { class: 'alert' + (open ? ' open' : ''), onclick: () => { open ? st.open.delete(i) : st.open.add(i); render(); } },
    h('div', { class: 't' }, h('b', {}, a.title || a.rule || 'Alert'), h('time', {}, ago(a.at))),
    a.body && h('p', {}, a.body),
    h('div', { class: 'srcs' },
      a.tracker && h('span', { class: 'src' }, icon(/mail|gmail|outlook|yahoo|icloud/i.test(a.tracker) ? 'mail' : 'chat', 14), a.tracker),
      a.computer && st.computers.length > 1 && h('span', { class: 'src' }, icon('monitor', 14), a.computer)));
};

const alertsScreen = () => st.alerts.length
  ? [...st.alerts.map(alertCard),
      h('div', { class: 'row center' }, st.confirmClear
        ? [h('button', { class: 'btn danger', onclick: async () => { await WG.clear(); st.alerts = []; st.confirmClear = false; render(); } }, icon('trash'), 'Clear all'), h('button', { class: 'btn ghost', onclick: () => { st.confirmClear = false; render(); } }, 'Keep')]
        : h('button', { class: 'btn ghost', onclick: () => { st.confirmClear = true; render(); } }, icon('trash'), 'Clear'))]
  : [h('div', { class: 'empty' }, h('span', { class: 'bigicon' }, icon('bell', 30)), h('b', {}, 'No alerts yet'))];

const computerRow = (c) => h('button', { class: 'crow', onclick: () => { if (!c.paired) { st.adding = c.id; st.view = 'add'; render(); } } },
  h('span', { class: 'lead' }, icon('monitor', 20)),
  h('span', { class: 'ctext' }, h('b', {}, c.name), h('small', {}, c.paired ? (c.lastAt ? `Last alert ${ago(c.lastAt)}` : 'Connected') : 'Waiting to connect')),
  c.paired ? h('span', { class: 'okmark' }, icon('check', 18)) : h('span', { class: 'spin' }));

const computersScreen = () => [
  h('button', { class: 'btn primary wide', onclick: startScan }, icon('scan'), 'Add computer'),
  st.computers.length
    ? h('div', { class: 'list' }, st.computers.map(computerRow))
    : h('div', { class: 'empty' }, h('span', { class: 'bigicon' }, icon('monitor', 30)), h('b', {}, 'No computer yet')),
  h('div', { class: 'card field' },
    h('label', { for: 'devname' }, `This ${noun}`),
    h('input', { id: 'devname', type: 'text', value: st.name, autocomplete: 'off', maxlength: 40, onchange: async (e) => { st.name = e.target.value.trim() || st.name; await WG.set('name', st.name); render(); toast('Saved'); } }),
    h('p', { class: 'hint' }, 'The name your computers show for it.')),
  h('div', { class: 'row center' }, h('button', { class: 'btn ghost danger', onclick: disable }, icon('power'), 'Turn off alerts')),
];

const addScreen = () => {
  const c = st.computers.find((x) => x.id === st.adding);
  return [
    h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:14px' },
      c
        ? h('div', { class: 'state' }, h('span', { class: 'lead' }, icon('monitor', 20)), h('b', {}, c.name))
        : h('div', { class: 'state' }, icon('monitor'), 'Your computer'),
      c?.paired
        ? h('div', { class: 'state ok' }, icon('check'), 'Connected')
        : st.stale
          ? h('div', { class: 'state' }, icon('alert'), `This ${noun} needs a new code`)
          : h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Waiting for your computer'),
      h('pre', { class: 'code' }, codeOf()),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => copy(codeOf()) }, icon('copy'), 'Copy code'),
        navigator.share && h('button', { class: 'btn', onclick: () => navigator.share({ text: codeOf() }).catch(() => {}) }, icon('share'), 'Share')),
      h('p', { class: 'hint' }, `Paste it in whatsgrep on ${c ? c.name : 'your computer'}: Delivery, then Add device. Keep it private.`)),
    c?.paired && h('div', { class: 'row center' }, h('button', { class: 'btn primary', onclick: () => { st.view = 'tabs'; st.adding = null; render(); } }, icon('check'), 'Done')),
  ];
};

// ---- page ----------------------------------------------------------------------------------

function render() {
  const mark = $('#mark');
  if (!mark.firstChild) mark.append(icon('mark', 18));

  const needsInstall = isIOS && !standalone;
  const ready = canPush && !needsInstall && st.enabled;
  const adding = ready && st.view === 'add';

  // top bar: title of where you are, back from a sub-screen, and the connection
  const title = !ready ? 'whatsgrep' : adding ? 'Add computer' : st.tab === 'alerts' ? 'Alerts' : 'Computers';
  $('#title').textContent = title;
  const back = $('#back');
  back.hidden = !adding;
  if (adding && !back.firstChild) back.append(icon('left'));
  back.onclick = () => { st.view = 'tabs'; st.adding = null; render(); };
  $('#mark').hidden = adding;

  const status = $('#status');
  status.hidden = !ready || adding;
  if (ready) {
    const connected = st.paired || st.computers.some((c) => c.paired);
    status.className = 'tstatus ' + (st.stale ? 'bad' : connected ? 'ok' : 'warn');
    $('#statustext').textContent = st.stale ? 'Needs a new code' : connected ? 'Connected' : 'Not paired';
  }

  // bottom bar, like a chat app: Alerts and Computers, with a count of unread alerts
  const tabs = $('#tabs');
  tabs.hidden = !ready || adding;
  if (ready) {
    const [a, c] = tabs.querySelectorAll('button');
    const n = unread();
    a.replaceChildren(h('span', { class: 'pillicon' }, icon('bell', 22), n > 0 && st.tab !== 'alerts' && h('i', { class: 'badge' }, n > 9 ? '9+' : String(n))), h('span', {}, 'Alerts'));
    c.replaceChildren(h('span', { class: 'pillicon' }, icon('monitor', 22)), h('span', {}, 'Computers'));
    for (const b of [a, c]) {
      b.classList.toggle('on', b.dataset.tab === st.tab);
      b.onclick = () => { st.tab = b.dataset.tab; st.view = 'tabs'; render(); void markSeen().then(() => { if (st.tab === 'alerts') render(); }); };
    }
  }
  document.body.classList.toggle('hastabs', ready && !adding);

  $('#main').replaceChildren(...(needsInstall ? installScreen() : !canPush ? unsupportedScreen() : !st.enabled ? welcomeScreen() : adding ? addScreen() : st.tab === 'computers' ? computersScreen() : alertsScreen()));
}

async function start() {
  if (canPush) await navigator.serviceWorker.register('sw.js').catch(() => {});
  await load().catch(() => {});
  // opened from a scanned link: it says which computer this is
  const fromLink = parseLink(location.href);
  if (fromLink) history.replaceState(null, '', location.pathname);
  if (fromLink) { if (st.enabled) await addComputer(fromLink); else await WG.set('pendingComputer', fromLink); }
  render();
  await markSeen();
  render();
  $('#scanclose').innerHTML = '';
  $('#scanclose').append(icon('x'));
  $('#scanclose').onclick = stopScan;
  $('#scanalt').onclick = () => { stopScan(); st.adding = null; st.view = 'add'; st.tab = 'computers'; render(); };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); st.installEvt = e; render(); });
  if (!canPush) return;
  navigator.serviceWorker.addEventListener('message', async (e) => {
    await load();
    if (e.data?.t === 'paired') toast('Connected to your computer');
    await markSeen();
    render();
  });
  document.addEventListener('visibilitychange', async () => { if (!document.hidden) { await load().catch(() => {}); await markSeen(); render(); } });
  setInterval(render, 60000); // keeps "5m" fresh
}

start();
