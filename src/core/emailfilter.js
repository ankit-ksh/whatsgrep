import { compileChat, compileSection, compileTerm, matchSection } from './matcher.js';

// The conditions only email has, beyond sender and words. In a rule they sit under `email:`:
//
//   email:
//     to: {any: [sales@example.com]}        recipients (To and Cc)
//     subject: {any: [invoice], exclude: [newsletter]}   (equals: ["Invoice 4821"] = the whole subject)
//     body: {any: ["payment due"]}                        the text of the mail, without the subject
//     attachment: true | false | [pdf, xlsx, "contains:invoice"]
//     larger_than: 1MB
//     smaller_than: 20MB
//     not_bulk: true                        skip newsletters, mailing lists and auto-replies
//     verified: true                        the sender passed the server's SPF/DKIM/DMARC checks
//     important: true                      marked high priority by the sender
//     during: {days: [mon, tue], from: "09:00", to: "18:00"}   only alert in this window

const UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
export function parseSize(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^([\d.]+)\s*([kmg]?b)?$/i);
  if (!m) throw new Error(`"${v}" is not a size (use 500KB, 2MB, 1GB)`);
  return Math.round(Number(m[1]) * UNITS[(m[2] ?? 'b').toLowerCase()]);
}

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const toMinutes = (t) => {
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || m[1] > 23 || m[2] > 59) throw new Error(`"${t}" is not a time (use 09:00)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

// Attachment entries: "pdf" matches the file type or extension, "contains:x" the file name.
function attachmentTest(entry) {
  const t = String(entry).trim().toLowerCase();
  const m = t.match(/^(contains|exact|re):\s*(.*)$/s);
  if (m?.[1] === 're') { const re = new RegExp(m[2], 'i'); return (a) => re.test(a.name); }
  if (m) return m[1] === 'contains' ? (a) => a.name.toLowerCase().includes(m[2]) : (a) => a.name.toLowerCase() === m[2];
  const ext = t.replace(/^\./, '');
  return (a) => a.name.toLowerCase().endsWith(`.${ext}`) || a.type.toLowerCase().includes(ext);
}

export function compileEmailFilter(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const f = {};
  if (raw.to != null) f.to = compileSection(raw.to, compileChat);
  if (raw.subject != null) f.subject = compileSection(raw.subject, compileTerm);
  if (raw.body != null) f.body = compileSection(raw.body, compileTerm);
  const att = raw.attachment;
  if (att === true || att === false) f.attachment = att;
  else if (att != null) f.attachment = [att].flat().map(attachmentTest);
  const larger = parseSize(raw.larger_than), smaller = parseSize(raw.smaller_than);
  if (larger !== undefined) f.larger = larger;
  if (smaller !== undefined) f.smaller = smaller;
  for (const [key, name] of [['not_bulk', 'notBulk'], ['verified', 'verified'], ['important', 'important']]) if (raw[key] === true) f[name] = true;
  const d = raw.during;
  if (d && typeof d === 'object') {
    const days = [d.days ?? []].flat().map((x) => DAYS.indexOf(String(x).slice(0, 3).toLowerCase()));
    if (days.includes(-1)) throw new Error(`during.days must be from: ${DAYS.join(', ')}`);
    f.during = { days, from: d.from != null ? toMinutes(d.from) : undefined, to: d.to != null ? toMinutes(d.to) : undefined };
    if ((f.during.from === undefined) !== (f.during.to === undefined)) throw new Error('during needs both from and to');
  }
  return Object.keys(f).length ? f : undefined;
}

const inWindow = ({ days, from, to }, now) => {
  if (days.length && !days.includes(now.getDay())) return false;
  if (from === undefined) return true;
  const m = now.getHours() * 60 + now.getMinutes();
  return from <= to ? m >= from && m < to : m >= from || m < to; // a window like 22:00 to 06:00 crosses midnight
};

export function matchesEmailFilter(f, mail, now = new Date()) {
  if (!f) return true;
  const recipients = [...(mail.to ?? []), ...(mail.cc ?? [])].map((a) => a.toLowerCase());
  if (f.to && !matchSection(f.to, (test) => recipients.some(test))) return false;
  if (f.subject && !matchSection(f.subject, (re) => re.test(mail.subject))) return false;
  if (f.body && !matchSection(f.body, (re) => re.test(mail.text))) return false;
  const atts = mail.attachments ?? [];
  if (f.attachment === true && !atts.length) return false;
  if (f.attachment === false && atts.length) return false;
  if (Array.isArray(f.attachment) && !atts.some((a) => f.attachment.some((t) => t(a)))) return false;
  if (f.larger !== undefined && !(mail.size > f.larger)) return false;
  if (f.smaller !== undefined && !(mail.size < f.smaller)) return false;
  if (f.notBulk && (mail.bulk || mail.auto)) return false;
  if (f.verified && mail.verified !== 'pass') return false;
  if (f.important && !mail.important) return false;
  if (f.during && !inWindow(f.during, now)) return false;
  return true;
}
