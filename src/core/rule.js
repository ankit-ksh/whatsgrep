import { compileEmailFilter, matchesEmailFilter } from './emailfilter.js';
import { compileChat, compileSection, compileTerm, hasTrigger, isEverywhereValue, matchSection } from './matcher.js';
import { searchText, senderKeys } from './mail.js';

// Where a rule listens (`on:`): "all" = every tracker, a name or list of names = those trackers.
// Rules written before trackers existed have no `on:` and keep listening to WhatsApp only.
export function parseOn(on) {
  if (on == null) return { mode: 'legacy', names: [] };
  const list = [on].flat().map((x) => String(x).trim()).filter(Boolean);
  if (list.length === 1 && ['all', 'any', '*'].includes(list[0].toLowerCase())) return { mode: 'all', names: [] };
  return { mode: 'names', names: list };
}

export function compileRule(rule) {
  // Older configs: `chats` and any/all/none directly on the rule are still accepted.
  const from = rule.from ?? rule.chats;
  const message = rule.message ?? { any: rule.any, all: rule.all, exclude: rule.exclude, none: rule.none };
  return {
    name: rule.name,
    from: compileSection(isEverywhereValue(from) ? null : from, compileChat, { everywhere: true }),
    message: compileSection(message, compileTerm),
    email: compileEmailFilter(rule.email),
    on: parseOn(rule.on),
    priority: rule.priority,
  };
}

export const hasMessageCondition = (rule) => hasTrigger(rule.message);
// A rule must say what to look for: words, a sender/chat restriction, or an email condition.
// Otherwise it would fire on every message.
export const isUsable = (rule) => hasTrigger(rule.message) || hasTrigger(rule.from) || !!rule.email;

export const matchesMessage = (rule, text) => matchSection(rule.message, (re) => re.test(text));

// `chat` is a name or id, or an array of them (name, id, phone@c.us); any one may match.
export function matchesChat(rule, chat) {
  const keys = [chat].flat().flatMap((c) => {
    const k = (c ?? '').toLowerCase();
    return k.endsWith('@c.us') ? [k, k.split('@')[0]] : [k];  // 1-to-1 chat id -> phone number
  });
  return matchSection(rule.from, (test) => keys.some(test));
}

// Does this rule listen to that tracker ({ name, type })?
export function appliesTo(rule, tracker) {
  const { mode, names } = rule.on;
  if (mode === 'all') return true;
  if (mode === 'legacy') return tracker.type === 'whatsapp';
  return names.some((n) => n.toLowerCase() === tracker.name.toLowerCase());
}

export const matches = (rule, text, chat) => isUsable(rule) && matchesChat(rule, chat) && matchesMessage(rule, text);

export const matchesMail = (rule, mail, now) =>
  isUsable(rule) && matchesChat(rule, senderKeys(mail)) && matchesMessage(rule, searchText(mail)) && matchesEmailFilter(rule.email, mail, now);
