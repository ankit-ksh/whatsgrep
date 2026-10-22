const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Words in `message`: plain or "exact:x" = whole word/phrase, "contains:x" = anywhere inside
// a word, "re:x" = raw regex. All case-insensitive; spaces in a phrase match any whitespace.
export function compileTerm(term) {
  let t = String(term).trim();
  const m = t.match(/^(exact|contains|re):\s*(.*)$/is);
  const kind = m ? m[1].toLowerCase() : 'exact';
  if (m) t = m[2];
  if (kind === 're') return new RegExp(t, 'iu');
  const body = t.split(/\s+/).map(escapeRe).join('\\s+');
  if (kind === 'contains') return new RegExp(body, 'iu');
  const left = /^\w/.test(t) ? '\\b' : '';
  const right = /\w$/.test(t) ? '\\b' : '';
  return new RegExp(left + body + right, 'iu');
}

// Chat entries: plain = exact name/id/phone, "contains:x" = substring, "re:x" = regex,
// "exact:x" = explicit exact. All case-insensitive.
// Phone numbers ignore +, spaces and dashes, and match by suffix (country code optional).
function compileChat(entry) {
  const t = String(entry).trim();
  const m = t.match(/^(exact|contains|re):\s*(.*)$/is);
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

const KINDS = ['exact', 'contains', 're'];
const prefixed = (obj) => KINDS.flatMap((k) => [obj[k] ?? []].flat().map((v) => `${k}:${v}`));

// A list of entries, or an object { exact: [...], contains: [...], re: [...] } (all alternatives).
const entries = (v) => (v == null ? [] : typeof v === 'object' && !Array.isArray(v) ? prefixed(v) : [v].flat());

// Both sections ("from" for chats, "message" for text) take the same shape:
//   any: [...]      at least one matches
//   all: [...]      every entry matches (an entry that is a [list] means "one of these")
//   exclude: [...]  none match      (`none` is accepted as an older name)
// A bare list/string means `any`, and exact/contains/re keys directly in the section add to `any`.
// Each of any / exclude can be a list or { exact, contains, re }. `all` as { exact, contains, re }
// means every listed entry must match.
function compileSection(input, compile, { everywhere = false } = {}) {
  const sec = input == null ? {} : typeof input === 'object' && !Array.isArray(input) ? input : { any: [input].flat() };
  if (everywhere && [sec.any].flat().some((v) => v != null && isEverywhere(v))) return { any: [], all: [], exclude: [] };
  const all = sec.all == null ? [] : Array.isArray(sec.all) ? sec.all : entries(sec.all);
  return {
    any: [...entries(sec.any), ...prefixed(sec)].flatMap((e) => toGroup(e, compile)),
    all: all.map((e) => toGroup(e, compile)),
    exclude: entries(sec.exclude ?? sec.none).flatMap((e) => toGroup(e, compile)),
  };
}

export function compileRule(rule) {
  // Older configs: `chats` and any/all/none directly on the rule are still accepted.
  const from = rule.from ?? rule.chats;
  const message = rule.message ?? { any: rule.any, all: rule.all, exclude: rule.exclude, none: rule.none };
  return {
    name: rule.name,
    from: compileSection(isEverywhereValue(from) ? null : from, compileChat, { everywhere: true }),
    message: compileSection(message, compileTerm),
    priority: rule.priority,
  };
}
const isEverywhereValue = (v) => v != null && typeof v !== 'object' && isEverywhere(v);

// any: one test must pass (skipped if empty) | all: every group needs one passing test | exclude: none pass
const matchSection = (sec, passes) =>
  (!sec.any.length || sec.any.some(passes)) &&
  sec.all.every((group) => group.some(passes)) &&
  !sec.exclude.some(passes);

const hasTrigger = (sec) => sec.any.length > 0 || sec.all.length > 0;
export const hasMessageCondition = (rule) => hasTrigger(rule.message);
// A rule must say what to look for: message.any/all, or a from.any/all restricting the chats.
// Otherwise it would fire on every message.
export const isUsable = (rule) => hasTrigger(rule.message) || hasTrigger(rule.from);

export const matchesMessage = (rule, text) => matchSection(rule.message, (re) => re.test(text));

// `chat` is a name or id, or an array of them (name, id, phone@c.us); any one may match.
export function matchesChat(rule, chat) {
  const keys = [chat].flat().flatMap((c) => {
    const k = (c ?? '').toLowerCase();
    return k.endsWith('@c.us') ? [k, k.split('@')[0]] : [k];  // 1-to-1 chat id -> phone number
  });
  return matchSection(rule.from, (test) => keys.some(test));
}

export const matches = (rule, text, chat) => isUsable(rule) && matchesChat(rule, chat) && matchesMessage(rule, text);
