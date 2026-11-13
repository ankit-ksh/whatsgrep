// What a rule sees of an email. These are pure helpers on the mail object that
// trackers/email/parse.js builds, so the rules code never needs a mail library.

// What a rule's "from" is tested against: the display name and the address. Use
// "contains:@example.com" to match a whole domain.
export const senderKeys = (mail) => [mail.fromName, mail.fromAddress].filter(Boolean);

// What a rule's words are tested against: the subject and the body.
export const searchText = (mail) => `${mail.subject}\n\n${mail.text}`.trim();

export const senderLabel = (mail) => mail.fromName || mail.fromAddress || 'unknown sender';

// A short preview for the notification body.
export function preview(mail, max = 280) {
  const body = mail.text.replace(/\s+/g, ' ').slice(0, max);
  return mail.subject ? (body ? `${mail.subject}\n${body}` : mail.subject) : body;
}
