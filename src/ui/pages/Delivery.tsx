import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { DeviceDialog } from '../dialogs/DeviceDialog';
import { Icon } from '../icons';
import { useApp } from '../store';
import type { DevicesInfo } from '../types';
import { Card, CardHead, Empty, IconBtn, Switch, Tip } from '../ui';

const METHODS = ['desktop', 'devices'];

export function Delivery() {
  const { S, val, stage, pending, toast, ask, guard } = useApp();
  const [info, setInfo] = useState<DevicesInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [cname, setCname] = useState<string | null>(null);
  const load = useCallback(async () => { setInfo(await api<DevicesInfo>('GET', '/api/devices').catch(() => null)); }, []);
  useEffect(() => { void load(); }, [load]);

  const methods = val('notifications') ?? [];
  const on = (m: string) => methods.includes(m);
  if (!S.config) return <Card><Empty title="No config yet" /></Card>;

  const toggle = (m: string) => (checked: boolean) => {
    const set = new Set(methods);
    if (checked) set.add(m); else set.delete(m);
    if (!set.size) { toast('At least one notification type must stay on.', { err: true }); return; }
    stage('notifications', METHODS.filter((x) => set.has(x)));
  };
  const devices = info?.devices ?? [];
  const unsaved = 'notifications' in pending;
  const desktopOk = on('desktop') && !unsaved;
  const sendTest = (method: string, done: string) => guard(async () => { await api('POST', '/api/notify/test', { method }); toast(done); });
  const saveName = guard(async () => {
    const n = (cname ?? '').trim();
    if (!n || n === info?.computer) { setCname(null); return; }
    await api('PUT', '/api/computer', { name: n });
    setCname(null);
    await load();
    toast('Saved');
  });
  const remove = (id: string, name: string) => guard(async () => {
    if (!(await ask({ title: `Remove ${name}?`, body: 'It stops getting alerts. You can add it again later.', ok: 'Remove', danger: true }))) return;
    await api('POST', '/api/devices/remove', { id });
    await load();
  });

  return (
    <>
      <Card>
        <div className={'setting' + (unsaved ? ' changed' : '')}>
          <div className="what withlead"><span className="lead"><Icon name="bell" size={18} /></span><b>Desktop notifications<Tip text="A pop-up on this computer while you are logged in." /></b></div>
          <div className="ctl">
            <button className="btn" disabled={!desktopOk} title={desktopOk ? undefined : on('desktop') ? 'Save your changes first' : 'Turn desktop notifications on first'} onClick={sendTest('desktop', 'Sent. Did a notification appear?')}><Icon name="send" size={16} />Send a test notification</button>
            <Switch checked={on('desktop')} onChange={toggle('desktop')} label="Desktop notifications" locked={on('desktop') && methods.length === 1} />
          </div>
        </div>
        <div className={'setting' + (unsaved ? ' changed' : '')}>
          <div className="what withlead"><span className="lead"><Icon name="phone" size={18} /></span><b>Devices<Tip text="Alerts on your phones, tablets and laptops, encrypted on this computer so only they can read them." /></b></div>
          <div className="ctl">
            <button className="btn" disabled={!devices.length} title={devices.length ? 'Sends to every paired device' : 'Add a device first'} onClick={sendTest('devices', `Test notification sent to ${devices.length === 1 ? devices[0].name : devices.length + ' devices'}`)}><Icon name="send" size={16} />Send to all devices</button>
            <Switch checked={on('devices')} onChange={toggle('devices')} label="Device notifications" locked={on('devices') && methods.length === 1} />
          </div>
        </div>
      </Card>

      <Card off={!on('devices')}>
        <CardHead title="Devices" style={{ paddingBottom: 14 }} action={<IconBtn icon="plus" label="Add device" cls="primary" disabled={!info} onClick={() => setAdding(true)} />} />
        {on('devices') && info && (
          <div className="setting" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="what withlead"><span className="lead"><Icon name="monitor" size={18} /></span><b>This computer<Tip text="The name your devices show next to each alert, so you can tell computers apart." /></b></div>
            <div className="ctl"><input type="text" aria-label="Computer name" value={cname ?? info.computer} onChange={(e) => setCname(e.target.value)} onBlur={() => void saveName()} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></div>
          </div>
        )}
        {on('devices') && !devices.length && <Empty title="No device yet" />}
        {on('devices') && devices.map((p) => (
          <div key={p.id} className="setting" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="what withlead"><span className="lead"><Icon name="phone" size={18} /></span><b>{p.name}</b></div>
            <div className="ctl">
              <span className="muted" style={{ fontSize: 13 }}>{new Date(p.addedAt).toLocaleDateString()}</span>
              <IconBtn icon="send" label={`Send a test to ${p.name}`} onClick={guard(async () => { await api('POST', '/api/notify/test', { method: 'devices', device: p.id }); toast(`Test notification sent to ${p.name}`); })} />
              <IconBtn icon="trash" label={`Remove ${p.name}`} onClick={remove(p.id, p.name)} />
            </div>
          </div>
        ))}
      </Card>

      {adding && info && <DeviceDialog info={info} onClose={() => setAdding(false)} onDone={(p) => { setAdding(false); toast(`${p.name} is connected`); void load(); }} />}
    </>
  );
}
