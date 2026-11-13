let token: string | null = new URLSearchParams(location.search).get('t');
try { if (token) sessionStorage.setItem('wg', token); else token = sessionStorage.getItem('wg'); } catch { /* storage can be blocked */ }
history.replaceState(null, '', '/' + location.hash);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { 'x-token': token ?? '', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

// The login QR of a WhatsApp tracker, as an image address.
export async function qrImage(trackerId: string): Promise<string | null> {
  const res = await fetch('/api/qr.svg?tracker=' + encodeURIComponent(trackerId), { headers: { 'x-token': token ?? '' } }).catch(() => null);
  if (!res?.ok) return null;
  return 'data:image/svg+xml;base64,' + btoa(await res.text());
}
