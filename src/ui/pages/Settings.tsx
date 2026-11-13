import { Icon } from '../icons';
import { useApp } from '../store';
import { Card, CardHead, Empty, Switch, Tip } from '../ui';

export function Settings() {
  const { S, val, stage, pending, toast, guard } = useApp();
  if (!S.config) return <Card><Empty title="No config yet" /></Card>;
  const chg = (k: keyof typeof pending) => (k in pending ? ' changed' : '');
  const copy = (text: string) => guard(async () => { await navigator.clipboard.writeText(text); toast('Copied'); });
  const hours = val('repeatWindowHours');
  return (
    <>
      <Card>
        <div className={'setting' + chg('runAtLogin')}>
          <div className="what"><b>Run at login<Tip text="Starts whatsgrep in the background when you log in, and restarts it if it stops." /></b>{S.profile && <div className="hint">Not in a test profile</div>}</div>
          <div className="ctl"><Switch checked={!!val('runAtLogin')} locked={!!S.profile} onChange={(on) => stage('runAtLogin', on)} label="Run at login" /></div>
        </div>
        <div className={'setting' + chg('repeatWindowHours')}>
          <div className="what"><b>Ignore repeats for<Tip text="Alert once for the same text from the same sender within this many hours. Empty or 0 alerts every time." /></b></div>
          <div className="ctl"><input type="number" min={0} step="any" aria-label="Hours" value={hours ?? ''} onChange={(e) => stage('repeatWindowHours', e.target.value)} /><span className="muted">hours</span></div>
        </div>
        <div className={'setting' + chg('browser')}>
          <div className="what"><b>Browser<Tip text="WhatsApp needs Chrome, Chromium, Edge or Brave. Leave empty to find it automatically." /></b>{!S.browserFound && <div className="hint">None found</div>}</div>
          <div className="ctl"><input type="text" aria-label="Browser path" value={String(val('browser') ?? '')} onChange={(e) => stage('browser', e.target.value)} /></div>
        </div>
      </Card>
      <Card>
        <CardHead title="Where things are stored" />
        <div className="body">
          <div className="loc"><span className="k">Config file</span><code>{S.configFile}</code><button className="btn ghost icon" title="Copy" aria-label="Copy config path" onClick={copy(S.configFile)}><Icon name="copy" size={16} /></button></div>
          <div className="loc"><span className="k">Sessions and data</span><code>{S.dataDir}</code><button className="btn ghost icon" title="Copy" aria-label="Copy data path" onClick={copy(S.dataDir)}><Icon name="copy" size={16} /></button></div>
          <div className="loc"><span className="k">Version</span><span className="muted">{S.version ? 'whatsgrep ' + S.version : 'unknown'}</span></div>
          <div className="loc"><span className="k">Secrets</span><span className="muted">{S.keychain}</span></div>
        </div>
      </Card>
    </>
  );
}
