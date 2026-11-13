const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Words in `message`: plain or "exact:x" = whole word/phrase, "contains:x" = anywhere inside
// a word, "equals:x" = the whole text is exactly this, "re:x" = raw regex. All case-insensitive;
// spaces in a phrase match any whitespace.
export function compileTerm(term) {
  let t = String(term).trim();
  const m = t.match(/^(exact|equals|contains|re):\s*(.*)$/is);
  const kind = m ? m[1].toLowerCase() : 'exact';
  if (m) t = m[2];
  if (kind === 're') return new RegExp(t, 'iu');
  const body = t.split(/\s+/).map(escapeRe).join('\\s+');
  if (kind === 'contains') return new RegExp(body, 'iu');
  if (kind === 'equals') return new RegExp(`^\\s*${body}\\s*$`, 'iu');
  const left = /^\w/.test(t) ? '\\b' : '';
  const right = /\w$/.test(t) ? '\\b' : '';
  return new RegExp(left + body + right, 'iu');
}

// Chat entries: plain = exact name/id/phone, "contains:x" = substring, "re:x" = regex,
// "exact:x" (or "equals:x") = explicit exact. All case-insensitive.
// Phone numbers ignore +, spaces and dashes, and match by suffix (country code optional).
export function compileChat(entry) {
  const t = String(entry).trim();
  const m = t.match(/^(exact|equals|contains|re):\s*(.*)$/is);
  if (m) {
    const kind = m[1].toLowerCase();
    const arg = m[2];
    if (kind === 're') { const re = new RegExp(arg, 'iu'); return (k) => re.test(k); }
    const want = arg.toLowerCase();
    return kind === 'contains' ? (k) => k.includes(want) : (k) => k === want;
  }
  const want = t.toLowerCase();
  if (/^[+\d][\d\s-]*$/.test(want)) {
    const digits = want.replace(/\D/g, '');
    if (digits.length >= 7) return (k) => /^\d+$/.test(k) && k.endsWith(digits);
    return (k) => k === digits;
  }
  return (k) => k === want;
}

const toGroup = (entry, compile) => (Array.isArray(entry) ? entry : [entry]).map(compile);

// Words meaning "every chat / no filter".
const isEverywhere = (v) => ['all', 'any', 'everywhere', '*'].includes(String(v).trim().toLowerCase());

const KINDS = ['exact', 'equals', 'contains', 're'];
const prefixed = (obj) => KINDS.flatMap((k) => [obj[k] ?? []].flat().map((v) => `${k}:${v}`));

// A list of entries, or an object { exact: [...], equals: [...], contains: [...], re: [...] } (all alternatives).
const entries = (v) => (v == null ? [] : typeof v === 'object' && !Array.isArray(v) ? prefixed(v) : [v].flat());

// Both sections ("from" for chats, "message" for text) take the same shape:
//   any: [...]      at least one matches
//   all: [...]      every entry matches (an entry that is a [list] means "one of these")
//   exclude: [...]  none match      (`none` is accepted as an older name)
// A bare list/string means `any`, and exact/contains/re keys directly in the section add to `any`.
// Each of any / exclude can be a list or { exact, contains, re }. `all` as { exact, contains, re }
// means every listed entry must match.
export function compileSection(input, compile, { everywhere = false } = {}) {
  const sec = input == null ? {} : typeof input === 'object' && !Array.isArray(input) ? input : { any: [input].flat() };
  if (everywhere && [sec.any].flat().some((v) => v != null && isEverywhere(v))) return { any: [], all: [], exclude: [] };
  const all = sec.all == null ? [] : Array.isArray(sec.all) ? sec.all : entries(sec.all);
  return {
    any: [...entries(sec.any), ...prefixed(sec)].flatMap((e) => toGroup(e, compile)),
    all: all.map((e) => toGroup(e, compile)),
    exclude: entries(sec.exclude ?? sec.none).flatMap((e) => toGroup(e, compile)),
  };
}

export const isEverywhereValue = (v) => v != null && typeof v !== 'object' && isEverywhere(v);

// any: one test must pass (skipped if empty) | all: every group needs one passing test | exclude: none pass
export const matchSection = (sec, passes) =>
  (!sec.any.length || sec.any.some(passes)) &&
  sec.all.every((group) => group.some(passes)) &&
  !sec.exclude.some(passes);

export const hasTrigger = (sec) => sec.any.length > 0 || sec.all.length > 0;
