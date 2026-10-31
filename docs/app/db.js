// A tiny store shared by the page and the service worker: settings, and the alerts received.
const WG = (() => {
  const open = () => new Promise((ok, fail) => {
    const r = indexedDB.open('whatsgrep', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('alerts', { autoIncrement: true }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((ok, fail) => {
      const tx = db.transaction(store, mode);
      const out = fn(tx.objectStore(store));
      tx.oncomplete = () => { db.close(); ok(out.result); };
      tx.onerror = () => { db.close(); fail(tx.error); };
    });
  };
  const KEEP = 200;
  return {
    get: (k) => run('kv', 'readonly', (s) => s.get(k)),
    set: (k, v) => run('kv', 'readwrite', (s) => s.put(v, k)),
    del: (k) => run('kv', 'readwrite', (s) => s.delete(k)),
    async add(alert) {
      await run('alerts', 'readwrite', (s) => s.add(alert));
      const keys = await run('alerts', 'readonly', (s) => s.getAllKeys());
      if (keys.length > KEEP) await run('alerts', 'readwrite', (s) => s.delete(IDBKeyRange.upperBound(keys[keys.length - KEEP - 1])));
    },
    async list() { return (await run('alerts', 'readonly', (s) => s.getAll())).reverse(); },
    clear: () => run('alerts', 'readwrite', (s) => s.clear()),
  };
})();
