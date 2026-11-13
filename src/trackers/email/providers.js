// Known mail providers: where to connect and how to get a password that works over IMAP.
// Gmail, Yahoo, iCloud and Fastmail want an "app password" (a separate password for apps, made
// in the account's security settings) because they block your normal password for IMAP.
export const PROVIDERS = {
  gmail: { label: 'Gmail', host: 'imap.gmail.com', port: 993, help: 'Turn on 2-step verification, then create an app password at myaccount.google.com/apppasswords.' },
  outlook: { label: 'Outlook.com / Hotmail', host: 'outlook.office365.com', port: 993, help: 'Needs an app password (Microsoft account security settings). Work or school accounts usually block this.' },
  yahoo: { label: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993, help: 'Create an app password in Yahoo account security.' },
  icloud: { label: 'iCloud', host: 'imap.mail.me.com', port: 993, help: 'Create an app-specific password at account.apple.com.' },
  fastmail: { label: 'Fastmail', host: 'imap.fastmail.com', port: 993, help: 'Create an app password under Settings, Privacy and security.' },
  other: { label: 'Other (IMAP)', host: '', port: 993, help: 'Use your provider\'s IMAP server name and the password for it.' },
};

// Guess the provider from the address so the form can fill itself in.
export function providerFor(address) {
  const d = String(address).split('@')[1]?.toLowerCase() ?? '';
  if (/^(gmail|googlemail)\.com$/.test(d)) return 'gmail';
  if (/^(outlook|hotmail|live|msn)\./.test(d)) return 'outlook';
  if (/^(yahoo|ymail|rocketmail)\./.test(d)) return 'yahoo';
  if (/^(icloud|me|mac)\.com$/.test(d)) return 'icloud';
  if (/^(fastmail)\./.test(d)) return 'fastmail';
  return 'other';
}
