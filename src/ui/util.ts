export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.round(m / 60) + ' h ago';
  return Math.round(m / 1440) + ' d ago';
}
export const fmtTime = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export const fmtNumber = (n?: string) => (n ? '+' + n : '');
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
