import type { EmailForm, RuleForm, Section, State, TrackerDef } from './types';

export const PRIORITIES: [string, string][] = [['min', 'Silent'], ['low', 'Low'], ['default', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']];
export const priorityLabel = (p: string) => (PRIORITIES.find((x) => x[0] === p) ?? ['', p])[1];
export const DAYS: [string, string][] = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

export const emptySection = (): Section => ({ any: [], all: [], exclude: [] });
export const emptyEmail = (): EmailForm => ({
  to: emptySection(), subject: emptySection(), body: emptySection(), attachment: '', attachmentTypes: [], larger: '', smaller: '',
  notBulk: false, verified: false, important: false, during: { enabled: false, days: [], from: '09:00', to: '18:00' },
});
export const newRule = (S: State): RuleForm => ({
  name: '', priority: 'default',
  on: S.trackers.some((t) => t.type === 'email') ? { mode: 'all', names: [] } : { mode: 'legacy', names: [] },
  from: emptySection(), message: emptySection(), email: emptyEmail(),
});

// The trackers a rule listens to. A rule without `on` listens to WhatsApp, as before trackers existed.
export function ruleTrackers(rule: RuleForm, trackers: TrackerDef[]): TrackerDef[] {
  if (rule.on.mode === 'all') return trackers;
  if (rule.on.mode === 'legacy') return trackers.filter((t) => t.type === 'whatsapp');
  return trackers.filter((t) => rule.on.names.some((n) => n.toLowerCase() === t.name.toLowerCase()));
}

const has = (s: Section) => s.any.length > 0 || s.all.some((g) => g.length > 0);
const used = (s: Section) => has(s) || s.exclude.length > 0;

// A rule is a list of conditions, each about one thing. Anything not listed is not checked.
export type Field = 'from' | 'message' | 'subject' | 'body' | 'to' | 'attachment' | 'size' | 'hours' | 'notBulk' | 'verified' | 'important';
export const FIELDS: Field[] = ['from', 'message', 'subject', 'body', 'to', 'attachment', 'size', 'hours', 'notBulk', 'verified', 'important'];
export const EMAIL_ONLY: Field[] = ['subject', 'body', 'to', 'attachment', 'size', 'hours', 'notBulk', 'verified', 'important'];

export function fieldIsSet(d: RuleForm, f: Field): boolean {
  const e = d.email;
  switch (f) {
    case 'from': return used(d.from);
    case 'message': return used(d.message);
    case 'subject': return used(e.subject);
    case 'body': return used(e.body);
    case 'to': return used(e.to);
    case 'attachment': return !!e.attachment;
    case 'size': return !!e.larger || !!e.smaller;
    case 'hours': return e.during.enabled;
    case 'notBulk': return e.notBulk;
    case 'verified': return e.verified;
    case 'important': return e.important;
  }
}

export function clearField(d: RuleForm, f: Field) {
  const e = d.email;
  switch (f) {
    case 'from': d.from = emptySection(); break;
    case 'message': d.message = emptySection(); break;
    case 'subject': e.subject = emptySection(); break;
    case 'body': e.body = emptySection(); break;
    case 'to': e.to = emptySection(); break;
    case 'attachment': e.attachment = ''; e.attachmentTypes = []; break;
    case 'size': e.larger = ''; e.smaller = ''; break;
    case 'hours': e.during = { enabled: false, days: [], from: '09:00', to: '18:00' }; break;
    case 'notBulk': e.notBulk = false; break;
    case 'verified': e.verified = false; break;
    case 'important': e.important = false; break;
  }
}

// What a condition is called, depending on what the rule listens to.
export function fieldLabel(f: Field, hasWA: boolean, hasMail: boolean): string {
  switch (f) {
    case 'from': return hasWA && hasMail ? 'Chat or sender' : hasMail ? 'Sender' : 'Chat';
    case 'message': return hasWA && hasMail ? 'Text' : hasMail ? 'Subject or body' : 'Message';
    case 'subject': return 'Subject';
    case 'body': return 'Body';
    case 'to': return 'Recipient';
    case 'attachment': return 'Attachment';
    case 'size': return 'Size';
    case 'hours': return 'Time of day';
    case 'notBulk': return 'Not a newsletter';
    case 'verified': return 'Verified sender';
    case 'important': return 'Marked important';
  }
}

export const fieldTip: Partial<Record<Field, string>> = {
  message: 'The words in the message. For email, the subject and the body together.',
  to: 'Mail sent to this address, such as an alias.',
  notBulk: 'Skips mailing lists, promotions and out-of-office replies.',
  verified: 'The mail server confirmed who sent it (SPF, DKIM or DMARC). Helps against look-alike scams.',
  important: 'The sender flagged it as high priority.',
  hours: 'Mail arriving at other times is not alerted.',
};

export function validity(d: RuleForm): string | null {
  if (!d.name.trim()) return 'Give the rule a name';
  if (d.on.mode === 'names' && !d.on.names.length) return 'Choose at least one tracker to listen to';
  if (!FIELDS.some((f) => fieldIsSet(d, f))) return 'Add at least one condition';
  return null;
}
