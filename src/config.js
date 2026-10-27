import { parse } from 'yaml';
import { compileRule, isUsable } from './matcher.js';
import { METHODS } from './notify.js';

export const DEFAULT_SERVER = 'https://ntfy.sh';

// Sections: `notifications` (methods), `ntfy` (server), `settings` (repeat_window_hours), `rules`.
export function parseConfig(text) {
  const doc = parse(text) ?? {};
  const hours = doc.settings?.repeat_window_hours ?? 6;
  if (typeof hours !== 'number' || hours < 0) throw new Error('settings.repeat_window_hours must be a number >= 0');
  const methods = doc.notifications ?? ['ntfy'];
  if (!Array.isArray(methods) || methods.some((m) => !METHODS.includes(m))) {
    throw new Error(`notifications must be a list of: ${METHODS.join(', ')}`);
  }
  if (!methods.length) throw new Error(`notifications needs at least one of: ${METHODS.join(', ')}`);
  const rules = (doc.rules ?? []).map(compileRule);
  rules.forEach((r, i) => {
    if (!r.name) throw new Error(`rule #${i + 1} needs a name`);
    if (!isUsable(r)) throw new Error(`rule "${r.name}" needs something to look for: message.any / message.all, or from.any / from.all`);
  });
  return { browser: doc.browser ?? undefined, methods: [...new Set(methods)], server: doc.ntfy?.server ?? DEFAULT_SERVER, repeatWindowMs: hours * 3600e3, rules };
}
