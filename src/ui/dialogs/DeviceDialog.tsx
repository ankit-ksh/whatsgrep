import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Device, DevicesInfo } from '../types';
import { Dialog, IconBtn, Lbl } from '../ui';

// Two steps: open the app on the device (scan), then paste the code it shows.
export function DeviceDialog({ info, onDone, onClose }: { info: DevicesInfo; onDone: (d: Device) => void; onClose: () => void }) {
  const { toast, guard } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ device: Device }>('POST', '/api/devices', { code });
      onDone(r.device);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <Dialog onClose={onClose} className="trackerdlg">
      <h3>Add a device</h3>
      <div className="formgrid">
        <div>
          <Lbl tip="In the app, open Computers, then Add computer, and scan this. Or scan it with the camera. iPhone: open it in Safari, then Share and Add to Home Screen, and open it from there.">Scan with the device</Lbl>
          <div className="devicepair">
            <img className="qr sm" alt="QR code of the app address and this computer" src={'data:image/svg+xml;base64,' + btoa(info.qr)} />
            <div className="loc"><code>{info.app}</code><IconBtn icon="copy" label="Copy address" onClick={guard(async () => { await navigator.clipboard.writeText(info.app); toast('Address copied'); })} /></div>
          </div>
        </div>
        <div>
          <Lbl tip="The app shows a code after you turn alerts on. It is private: paste it only here, on your own computer.">Code from the app</Lbl>
          <textarea className="mono" rows={4} spellCheck={false} autoComplete="off" aria-label="Code from the app" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div>}
        </div>
      </div>
      <div className="row-actions" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
        <IconBtn icon="check" label="Add device" cls="primary" busy={busy} disabled={!code.trim()} onClick={() => void add()} />
      </div>
    </Dialog>
  );
}
