import { parse } from 'yaml';
import { compileRule, isUsable } from './rule.js';
import { METHODS } from './notify.js';
import { PROVIDERS } from '../trackers/email/providers.js';

// Where the app is hosted (it is a static page; alerts never pass through it).
export const DEFAULT_APP = 'https://ankit-ksh.github.io/whatsgrep/app/';
const LEGACY_METHODS = ['ntfy'];
const RENAMED = { phone: 'devices' }; // what `devices` was called before
export const MAX_FOLDERS = 5; // one connection each: more risks the provider locking the account
export const TRACKER_TYPES = ['whatsapp', 'email'];

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// A config without `trackers` is one WhatsApp account, as in versions before trackers existed.
const LEGACY_TRACKERS = [{ id: 'whatsapp', name: 'WhatsApp', type: 'whatsapp', enabled: true }];

// `trackers` is a list of things to watch. The mailbox password is not in the file: it lives in
// the OS keychain.
function parseTrackers(list) {
  if (list == null) return LEGACY_TRACKERS;
  if (!Array.isArray(list)) throw new Error('trackers must be a list');
  const names = new Set(), ids = new Set();
  return list.map((t, i) => {
    const name = String(t?.name ?? '').trim();
    if (!name) throw new Error(`tracker #${i + 1} needs a name`);
    if (names.has(name.toLowerCase())) throw new Error(`tracker name "${name}" is used twice`);
    names.add(name.toLowerCase());
    const type = t.type;
    if (!TRACKER_TYPES.includes(type)) throw new Error(`tracker "${name}": type must be one of ${TRACKER_TYPES.join(', ')}`);
    const id = String(t.id ?? slug(name));
    if (!id || ids.has(id)) throw new Error(`tracker "${name}" needs a different name (its id "${id}" is taken)`);
    ids.add(id);
    const base = { id, name, type, enabled: t.enabled !== false };
    if (type === 'whatsapp') return base;
    const user = String(t.user ?? '').trim();
    if (!user) throw new Error(`tracker "${name}" needs a user (the email address)`);
    const preset = PROVIDERS[t.provider];
    if (t.provider && !preset) throw new Error(`tracker "${name}": unknown provider "${t.provider}" (use ${Object.keys(PROVIDERS).join(', ')})`);
    const host = String(t.host ?? preset?.host ?? '').trim();
    if (!host) throw new Error(`tracker "${name}" needs a host (the IMAP server)`);
    const port = Number(t.port ?? preset?.port ?? 993);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`tracker "${name}": port must be a number`);
    const folders = [t.folders ?? t.folder ?? 'INBOX'].flat().map(String).filter(Boolean);
    if (!folders.length) throw new Error(`tracker "${name}" needs at least one folder`);
    if (folders.length > MAX_FOLDERS) throw new Error(`tracker "${name}" watches ${folders.length} folders; each one is a separate connection to the mail server, so the limit is ${MAX_FOLDERS}`);
    return { ...base, user, provider: t.provider, host, port, secure: t.secure ?? port !== 143, folders };
  });
}

// Sections: `notifications` (methods), `devices` (app address), `settings` (repeat_window_hours),
// `trackers` (what to watch) and `rules`. `ntfy` is no longer supported: it is dropped and reported in `dropped`.
export function parseConfig(text) {
  const doc = parse(text) ?? {};
  const hours = doc.settings?.repeat_window_hours ?? 0;
  if (typeof hours !== 'number' || hours < 0) throw new Error('settings.repeat_window_hours must be a number >= 0');
  const raw = doc.notifications ?? ['desktop'];
  const listed = Array.isArray(raw) ? raw.map((m) => RENAMED[m] ?? m) : raw;
  if (!Array.isArray(listed) || listed.some((m) => ![...METHODS, ...LEGACY_METHODS].includes(m))) {
    throw new Error(`notifications must be a list of: ${METHODS.join(', ')}`);
  }
  if (!listed.length) throw new Error(`notifications needs at least one of: ${METHODS.join(', ')}`);
  const dropped = listed.filter((m) => LEGACY_METHODS.includes(m));
  const methods = listed.filter((m) => !LEGACY_METHODS.includes(m));
  if (!methods.length) methods.push('desktop');
  const app = String(doc.devices?.app ?? doc.phone?.app ?? DEFAULT_APP).trim();
  if (!/^https?:\/\//.test(app)) throw new Error('devices.app must be a web address (https://...)');
  const rules = (doc.rules ?? []).map(compileRule);
  rules.forEach((r, i) => {
    if (!r.name) throw new Error(`rule #${i + 1} needs a name`);
    if (!isUsable(r)) throw new Error(`rule "${r.name}" needs something to look for: words, a sender or chat, or an email condition`);
  });
  return { trackers: parseTrackers(doc.trackers), browser: doc.browser ?? undefined, methods: [...new Set(methods)], dropped, app: app.endsWith('/') ? app : `${app}/`, repeatWindowMs: hours * 3600e3, rules };
}
