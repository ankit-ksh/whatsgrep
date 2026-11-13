import { simpleParser } from 'mailparser';

const MAX_TEXT = 20000;

const addresses = (field) => [field?.value ?? []].flat().map((a) => (a.address ?? '').trim().toLowerCase()).filter(Boolean);

// Reads one raw message into what the rules need: sender, recipients, subject, text and the
// headers that say whether it is a newsletter, important or from a verified sender.
export async function parseMail(source) {
  const m = await simpleParser(source, { skipImageLinks: true, skipHtmlToText: false });
  const from = m.from?.value?.[0] ?? {};
  const text = String(m.text ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const h = (name) => String(m.headers.get(name) ?? '').toLowerCase();
  const auth = h('authentication-results');
  const priority = h('x-priority') + h('priority') + h('importance');
  return {
    fromName: (from.name ?? '').trim(),
    fromAddress: (from.address ?? '').trim().toLowerCase(),
    to: addresses(m.to),
    cc: addresses(m.cc),
    subject: String(m.subject ?? '').trim(),
    text: text.slice(0, MAX_TEXT),
    date: m.date ? m.date.getTime() : Date.now(),
    messageId: m.messageId ?? '',
    // mailparser gathers List-Unsubscribe, List-Id and the other List-* headers under one "list" entry.
    bulk: !!(m.headers.get('list') || /bulk|list|junk/.test(h('precedence'))),
    auto: (h('auto-submitted') && h('auto-submitted') !== 'no') || !!h('x-auto-response-suppress'),
    important: /(^|\D)[12]\b|high|urgent/.test(priority),
    verified: /\b(dkim|spf|dmarc)=pass\b/.test(auth) && !/\b(dkim|spf|dmarc)=fail\b/.test(auth) ? 'pass' : auth ? 'fail' : 'none',
  };
}

// Attachments come from the message structure, so they are known even when only the start of a
// large message was downloaded.
export function attachmentsOf(structure) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.childNodes?.length) return n.childNodes.forEach(walk);
    const name = n.dispositionParameters?.filename ?? n.parameters?.name ?? '';
    if (n.disposition === 'attachment' || (name && n.disposition !== 'inline')) out.push({ name, type: n.type ?? '', size: n.size ?? 0 });
  };
  walk(structure);
  return out;
}
