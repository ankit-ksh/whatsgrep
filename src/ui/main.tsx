import { createRoot } from 'react-dom/client';
import { api } from './api';
import { Shell } from './shell';
import { AppProvider } from './store';
import type { State } from './types';
import { errorText } from './util';

const WANT_API = 8;
const root = createRoot(document.getElementById('root')!);

async function boot() {
  let S: State;
  try {
    S = await api<State>('GET', '/api/state');
  } catch (e) {
    document.getElementById('root')!.textContent = 'Could not reach whatsgrep: ' + errorText(e) + '. Open the link printed by `whatsgrep ui` again.';
    return;
  }
  if (S.apiVersion !== WANT_API) {
    root.render(
      <div className="card"><div className="empty">
        <b>Restart whatsgrep to use this page</b>
        This page is newer than the whatsgrep program serving it, so some buttons would say “not found”. Stop it (press Ctrl+C in the terminal where you ran “whatsgrep ui”) and start it again, then reload this page.
        <div className="hint" style={{ marginTop: 10 }}>Your tracker and background service are not affected.</div>
      </div></div>,
    );
    return;
  }
  root.render(<AppProvider initial={S}><Shell /></AppProvider>);
}
void boot();
