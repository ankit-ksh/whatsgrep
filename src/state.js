import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const randomTopic = () => `wg-${randomBytes(16).toString('base64url')}`;

// Persists the ntfy topic. A flag overwrites it; otherwise the saved one is kept.
export function resolveTopic(dataDir, flag) {
  const file = join(dataDir, 'state.json');
  let state = {};
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch {}

  let source = 'saved';
  if (flag) {
    state.topic = flag === 'random' ? randomTopic() : flag;
    source = flag === 'random' ? 'generated (--topic random)' : 'set by --topic';
  } else if (!state.topic) {
    state.topic = randomTopic();
    source = 'generated (first run)';
  }

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  return { topic: state.topic, source };
}
