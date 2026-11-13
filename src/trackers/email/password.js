import { deleteSecret, getSecret, setSecret } from '../../core/secrets.js';

const key = (id) => `email:${id}`;
const envName = (id) => `WHATSGREP_EMAIL_PASSWORD_${String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

// Gmail shows app passwords in groups of four letters with spaces; the spaces are not part of it.
const clean = (host, pw) => (/gmail|google/i.test(host) ? pw.replace(/\s+/g, '') : pw);

// The OS keychain first. On a machine with no keychain (a server), an environment variable
// WHATSGREP_EMAIL_PASSWORD_<ID> works instead. The password is stored under the tracker's id,
// so renaming a tracker keeps it.
export const emailPassword = (tracker) => {
  const pw = getSecret(key(tracker.id)) ?? process.env[envName(tracker.id)];
  return pw ? clean(tracker.host, pw) : undefined;
};
export const saveEmailPassword = (tracker, password) => setSecret(key(tracker.id), clean(tracker.host, password));
export const forgetEmailPassword = (id) => deleteSecret(key(id));
export const hasEmailPassword = (tracker) => !!emailPassword(tracker);
