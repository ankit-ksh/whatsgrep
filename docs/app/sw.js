// Receives the encrypted pushes (the browser decrypts them), keeps them, and shows them.
importScripts('db.js');

const SHELL = 'whatsgrep-shell-v1';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'db.js', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// The page opens offline too, so past alerts can always be read. Online, the newest copy wins.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

self.addEventListener('push', (e) => {
  let m;
  try { m = e.data.json(); } catch { m = { t: 'alert', title: 'whatsgrep', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    if (m.t === 'alert') await WG.add({ title: m.title, body: m.body, rule: m.rule, chat: m.chat, tracker: m.tracker, at: m.at || Date.now() });
    if (m.t === 'paired') await WG.set('paired', true);
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ t: m.t });
    // Browsers require every push to show something.
    await self.registration.showNotification(m.title || 'whatsgrep', {
      body: m.body || '',
      icon: 'icon-192.png',
      badge: 'badge.png',
      tag: m.t === 'alert' ? undefined : m.t,
      timestamp: m.at || Date.now(),
      data: { t: m.t },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});

// The browser replaced or dropped the subscription: the code on the computer no longer works.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(WG.set('stale', true).then(() => self.clients.matchAll({ includeUncontrolled: true })).then((cs) => cs.forEach((c) => c.postMessage({ t: 'stale' }))));
});
