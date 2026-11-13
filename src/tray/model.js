// What the tray icon shows, decided from the tracker's status. Pure, so it is easy to test;
// the Linux and Windows backends only draw what this returns.
export const COLORS = { ok: '#2fd08f', busy: '#f5b942', bad: '#ff6b6b', off: '#8e99a8' };

const BUSY_STATES = ['starting', 'waiting for QR scan', 'linking'];

// pending: { wantRunning: boolean, until: ms } while a Start/Stop/Restart click is being carried out.
export function buildView(status, { pending, autostart, now = Date.now() } = {}) {
  const running = !!status?.running;
  const state = status?.state ?? 'stopped';
  const waiting = pending && pending.until > now ? pending : undefined;

  let tone, text;
  if (waiting && waiting.wantRunning && !(running && state === 'listening')) { tone = 'busy'; text = 'Starting…'; }
  else if (waiting && !waiting.wantRunning && running) { tone = 'busy'; text = 'Stopping…'; }
  else if (!running) { tone = state === 'needs login' || state === 'disconnected' ? 'bad' : 'off'; text = state === 'needs login' ? 'Needs login: open the interface' : 'Stopped'; }
  else if (state === 'listening') { tone = 'ok'; text = status.matches ? `Listening · ${status.matches} ${status.matches === 1 ? 'match' : 'matches'}` : 'Listening'; }
  else if (state === 'waiting for QR scan') { tone = 'busy'; text = 'Waiting for QR scan: open the interface'; }
  else if (BUSY_STATES.includes(state)) { tone = 'busy'; text = 'Starting…'; }
  else { tone = 'bad'; text = state[0].toUpperCase() + state.slice(1); }

  const items = [{ id: 'status', label: text, enabled: false }, { separator: true }];
  if (running) items.push({ id: 'stop', label: 'Stop tracking' }, { id: 'restart', label: 'Restart' });
  else items.push({ id: 'start', label: 'Start tracking' });
  items.push(
    { separator: true },
    { id: 'ui', label: 'Open interface' },
    { id: 'autostart', label: 'Show this icon at login', checked: !!autostart },
    { separator: true },
    { id: 'quit', label: 'Quit icon (tracking keeps going)' },
  );
  return { tone, color: COLORS[tone], tooltip: `whatsgrep · ${text}`, items };
}
