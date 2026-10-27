import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deleteSecret, getSecret, setSecret, storeName } from './secrets.js';

// 24 random bytes = 192 bits: unguessable, so the topic itself is the secret.
export const randomTopic = () => `wg-${randomBytes(24).toString('base64url')}`;

export const TOPIC_RE = /^[A-Za-z0-9_-]{8,64}$/;

const SECRET = 'ntfy-topic';

// The topic works like a password on public ntfy.sh, so it lives in the OS keychain. Where no
// keychain is available (headless Linux) it falls back to state.json, readable only by you.
// Anything already in state.json is moved into the keychain on first use.
//
// Each run gets a fresh random topic unless --topic sets one or `resume` reuses the saved one.
export function resolveTopic(dataDir, flag, resume) {
  const file = join(dataDir, 'state.json');
  let state = {};
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const saved = getSecret(SECRET) ?? state.topic;

  let topic = saved;
  let source = 'saved (--resume)';
  if (flag && flag !== 'random') {
    topic = flag;
    source = 'set by --topic';
  } else if (!(resume && !flag && saved)) {
    topic = randomTopic();
    source = flag === 'random' ? 'generated (--topic random)' : 'generated (new each run)';
  }

  const inKeychain = setSecret(SECRET, topic);
  if (inKeychain) delete state.topic;
  else state.topic = topic;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  return { topic, source, store: inKeychain ? storeName() : `${file} (no OS keychain available)` };
}

// The topic saved by the last run, and where it is kept.
export function savedTopic(dataDir) {
  const fromKeychain = getSecret(SECRET);
  if (fromKeychain) return { topic: fromKeychain, store: storeName() };
  try {
    const t = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).topic;
    if (t) return { topic: t, store: 'state.json' };
  } catch {}
}

export const forgetTopic = () => deleteSecret(SECRET);

// Stores a topic chosen in the UI (keychain, or state.json when there is none).
export function saveTopic(dataDir, topic) {
  if (!TOPIC_RE.test(topic)) throw new Error('A topic is 8-64 letters, digits, - or _ (no spaces).');
  const file = join(dataDir, 'state.json');
  let state = {};
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const inKeychain = setSecret(SECRET, topic);
  if (inKeychain) delete state.topic; else state.topic = topic;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}
