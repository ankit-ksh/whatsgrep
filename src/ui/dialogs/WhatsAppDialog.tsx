import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { editable, useApp } from '../store';
import type { State, TrackerDef } from '../types';
import { Dialog, IconBtn, Lbl } from '../ui';
import { errorText, slug } from '../util';
import { LinkBox, LinkSide, Stages, useLinkFlow } from './LinkDialog';

// Add a WhatsApp tracker, which watches one account. Two panes: the name on the left, and on the
// right the login code and its progress. The tracker is saved as soon as you add it, so it can link.
export function WhatsAppDialog({ onClose }: { onClose: () => void }) {
  const { S, pending, setS, go } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<TrackerDef | null>(null);
  const { view, retry } = useLinkFlow(current);
  const linked = view.kind === 'done' && !!current;

  const uniqueId = (n: string) => {
    let id = slug(n) || 'whatsapp', i = 2;
    while (S.trackers.some((t) => t.id === id)) id = `${slug(n) || 'whatsapp'}-${i++}`;
    return id;
  };

  async function add() {
    const n = name.trim();
    if (!n) return setError('Give it a name.');
    if (S.trackers.some((t) => t.name.toLowerCase() === n.toLowerCase())) return setError('Another tracker already has that name.');
    if ('trackers' in pending) return setError('Save or discard your other changes first.');
    setBusy(true);
    setError('');
    try {
      const def: TrackerDef = { id: uniqueId(n), name: n, type: 'whatsapp', enabled: true };
      const next = await api<State>('PUT', '/api/config', { trackers: [...S.trackers.map(editable), def] });
      setS(next);
      setCurrent(next.trackers.find((t) => t.id === def.id) ?? def);
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  return (
    <Dialog className="linkdlg wadlg" onClose={onClose}>
      <div className="wa-body">
        <div className="wa-left">
          <h3>Add WhatsApp</h3>
          {!current ? (
            <div className="formgrid">
              <div>
                <Lbl>Name</Lbl>
                <input type="text" aria-label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
                {error && <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div>}
              </div>
              <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
                <button className="btn primary" aria-label="Add and show login code" disabled={busy || !name.trim()} onClick={() => void add()}><Icon name="qr" size={16} />Add and link</button>
              </div>
            </div>
          ) : (
            <p className="hint" style={{ margin: 0 }}>{current.name}</p>
          )}
          {linked && (
            <div className="row-actions" style={{ justifyContent: 'flex-start', marginTop: 'auto' }}>
              <IconBtn icon="check" label="Done" cls="primary" onClick={(e) => e.currentTarget.closest('dialog')?.close()} />
            </div>
          )}
        </div>
        <div className="wa-right">
          {current ? (
            <>
              <div className="ld-box"><LinkBox view={view} /></div>
              <div className="ld-side"><LinkSide view={view} retry={retry} onLog={() => { onClose(); void go('advanced'); }} /></div>
            </>
          ) : (
            <>
              <div className="ld-box"><span className="bigicon idle"><Icon name="qr" size={30} /></span></div>
              <div className="ld-side"><Stages active={-1} waiting /></div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
