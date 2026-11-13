import { Icon } from '../icons';
import { MatchRow } from '../shell';
import { useApp } from '../store';
import { TrackerMark, accountLine, liveStatus, trackerView } from '../TrackerCard';
import { ago } from '../util';
import { api } from '../api';
import { Card, CardHead, IconBtn, Pill } from '../ui';


export function Overview() {
  const { S, setS, tracker, go, openTracker, guard } = useApp();
  const s = S.status;
  const recent = S.recentMatches.filter((m) => !m.dry).slice(0, 8);
  if (!S.configExists) {
    return (
      <>
        <Card><div className="empty"><b>Welcome to whatsgrep</b>
          <div className="row-actions" style={{ justifyContent: 'center', marginTop: 18 }}>
            <button className="btn primary" onClick={guard(async () => { setS(await api('POST', '/api/config/init')); })}>Create my config</button>
          </div></div></Card>
      </>
    );
  }
  const hasWhatsApp = S.trackers.some((t) => t.type === 'whatsapp' && t.enabled);
  const stat = (label: string, value: string) => <div className="stat"><span>{label}</span><b>{value}</b></div>;
  const liveCount = S.trackers.filter((t) => liveStatus(S, t.id)?.state === 'listening').length;

  return (
    <>
      {S.configError && <div className="alert bad"><Icon name="alert" /><div><b>The config file has a problem</b><span>{S.configError} Fix it in Advanced.</span></div></div>}
      {!S.browserFound && hasWhatsApp && <div className="alert"><Icon name="alert" /><div><b>No browser found</b><span>WhatsApp needs Chrome, Chromium, Edge or Brave. Set a path in Settings.</span></div></div>}
      <div className="stats">
        {stat('Status', s?.running ? tracker.label : 'Stopped')}
        {stat('Matches', String(s?.matches ?? 0))}
        {stat('Last match', s?.lastMatch ? ago(s.lastMatch) : 'None')}
        {stat('Trackers', `${liveCount} of ${S.trackers.filter((t) => t.enabled).length}`)}
        {stat('Rules', String(S.rules.length))}
        {stat('Alerts to', (S.config?.notifications ?? []).map((m) => (m === 'devices' ? 'Devices' : 'Desktop')).join(' + ') || 'Nowhere')}
      </div>
      <div className="ovgrid">
        <Card>
          <CardHead title="Trackers" style={{ paddingBottom: 8 }} />
          {S.trackers.length ? S.trackers.map((t) => {
            const v = trackerView(S, t);
            return (
              <button key={t.id} className="orow" onClick={() => void openTracker(t.id)}>
                <TrackerMark t={t} size={36} />
                <span className="tname"><b>{t.name}</b>{accountLine(S, t) && <span className="tsub">{accountLine(S, t)}</span>}</span>
                <Pill cls={v.pill[1]} spin={v.spin}>{v.pill[0]}</Pill>
              </button>
            );
          }) : <div className="empty" style={{ padding: 26 }}>None</div>}
        </Card>
        <Card>
          <CardHead title="Recent matches" style={{ paddingBottom: 8 }} />
          {recent.length
            ? <div>{recent.map((m) => <MatchRow key={m.t + m.rule} m={m} />)}<div className="rfoot"><IconBtn icon="right" label="View all notifications" cls="" onClick={() => void go('notifications')} /></div></div>
            : <div className="empty" style={{ padding: 26 }}>Nothing yet</div>}
        </Card>
      </div>
    </>
  );
}
