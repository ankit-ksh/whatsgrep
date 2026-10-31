// Converts between a rule as written in the config (many short forms) and a plain "form" shape
// the web UI edits:
//   { name, priority, from: Section, message: Section }
//   Section = { any: Entry[], all: Entry[][], exclude: Entry[] }
//   Entry   = { kind: 'exact' | 'contains' | 're' | 'phone', value }
// `any` = at least one, `all` = every group needs one of its entries, `exclude` = none.
// An empty section means "no restriction" (all chats / any text).
const KINDS = ['exact', 'contains', 're'];
const PHONE = /^[+\d][\d\s-]*$/;
const EVERYWHERE = ['all', 'any', 'everywhere', '*'];

function parseEntry(e, isChat) {
  const t = String(e).trim();
  const m = t.match(/^(exact|contains|re):\s*(.*)$/is);
  if (m) return { kind: m[1].toLowerCase(), value: m[2] };
  return { kind: isChat && PHONE.test(t) ? 'phone' : 'exact', value: t };
}

const prefixed = (obj) => KINDS.flatMap((k) => [obj[k] ?? []].flat().map((v) => `${k}:${v}`));
const entries = (v) => (v == null ? [] : typeof v === 'object' && !Array.isArray(v) ? prefixed(v) : [v].flat(Infinity));

function sectionToForm(input, isChat) {
  const bare = input == null || (typeof input !== 'object' && EVERYWHERE.includes(String(input).trim().toLowerCase()));
  const sec = bare ? {} : typeof input === 'object' && !Array.isArray(input) ? input : { any: [input].flat() };
  const parse = (e) => parseEntry(e, isChat);
  const anyList = [...entries(sec.any), ...prefixed(sec)];
  const everywhere = isChat && anyList.length === 1 && EVERYWHERE.includes(String(anyList[0]).trim().toLowerCase());
  const all = sec.all == null ? [] : Array.isArray(sec.all) ? sec.all : entries(sec.all);
  return {
    any: everywhere ? [] : anyList.map(parse),
    all: all.map((g) => [g].flat(Infinity).map(parse)),
    exclude: entries(sec.exclude ?? sec.none).map(parse),
  };
}

export function ruleToForm(rule) {
  const from = rule.from ?? rule.chats;
  const message = rule.message ?? { any: rule.any, all: rule.all, exclude: rule.exclude, none: rule.none };
  return {
    name: rule.name ?? '',
    priority: rule.priority ?? 'default',
    from: sectionToForm(from, true),
    message: sectionToForm(message, false),
  };
}

// An entry as a string. Plain only when that means the same thing; chats keep phone numbers plain
// (they match by suffix) and spell out "exact:" for everything else that looks like a number.
function entryString({ kind, value }, isChat) {
  if (kind === 'phone') return value;
  if (kind === 'exact') {
    const risky = /^(exact|contains|re):/i.test(value) || (isChat && PHONE.test(value));
    return risky ? `exact:${value}` : value;
  }
  return `${kind}:${value}`;
}

// any / exclude: { exact, contains, re } for readability, or a flat list when a phone is involved.
function listOrGrouped(list, isChat) {
  if (list.some((e) => e.kind === 'phone')) return list.map((e) => entryString(e, isChat));
  const out = {};
  for (const k of KINDS) {
    const vs = list.filter((e) => e.kind === k).map((e) => e.value);
    if (vs.length) out[k] = vs;
  }
  return out;
}

const clean = (list) => list.filter((e) => String(e.value ?? '').trim() !== '').map((e) => ({ kind: e.kind, value: String(e.value).trim() }));

function sectionToRule(sec, isChat) {
  const out = {};
  const any = clean(sec.any ?? []);
  const exclude = clean(sec.exclude ?? []);
  const all = (sec.all ?? []).map(clean).filter((g) => g.length);
  if (any.length) out.any = listOrGrouped(any, isChat);
  if (all.length) out.all = all.map((g) => g.map((e) => entryString(e, isChat)));
  if (exclude.length) out.exclude = listOrGrouped(exclude, isChat);
  return out;
}

export function formToRule(form) {
  const rule = { name: String(form.name ?? '').trim() };
  const from = sectionToRule(form.from ?? {}, true);
  const message = sectionToRule(form.message ?? {}, false);
  rule.from = Object.keys(from).length ? from : 'all';
  if (Object.keys(message).length) rule.message = message;
  if (form.priority && form.priority !== 'default') rule.priority = form.priority;
  return rule;
}
