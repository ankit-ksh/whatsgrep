import { useState } from 'react';
import { AddTrackerDialog } from '../dialogs/AddTrackerDialog';
import { TrackerDialog } from '../dialogs/TrackerDialog';
import { WhatsAppDialog } from '../dialogs/WhatsAppDialog';
import { Icon } from '../icons';
import { useApp } from '../store';
import { TrackerMark, accountLine, hintShown, trackerView } from '../TrackerCard';
import { useTrackerEdits } from '../trackerEdits';
import { Card, Empty, IconBtn, Pill, Switch } from '../ui';
import { ruleTrackers } from '../rules';
import type { TrackerKind } from '../trackerTypes';

// Everything whatsgrep watches, as cards. Open one to see and do everything about it.
export function Trackers() {
  const { S, trackers, openTracker } = useApp();
  const { list, upsert, setEnabled } = useTrackerEdits();
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState<TrackerKind['type'] | null>(null);
  if (!S.config) return <Card><Empty title="No config yet" /></Card>;
  const enabledCount = list.filter((t) => t.enabled).length;

  return (
    <>
      <div className="toolbar">
        <span style={{ flex: 1 }} />
        <IconBtn icon="plus" label="Add tracker" cls="primary" onClick={() => setPicking(true)} />
      </div>
      {!list.length && <Card><Empty title="No trackers yet" /></Card>}
      {list.length > 0 && !enabledCount && <div className="alert"><Icon name="alert" /><div><b>Every tracker is off</b></div></div>}
      <div className="tgrid">
        {trackers.map((t) => {
          const v = trackerView(S, t);
          const rules = S.rules.filter((r) => ruleTrackers(r, trackers).some((x) => x.id === t.id)).length;
          const alerts = S.recentMatches.filter((m) => !m.dry && m.tracker === t.name).length;
          const open = () => void openTracker(t.id);
          return (
            <div key={t.id} className={'card tile' + (t.enabled ? '' : ' off')} role="link" tabIndex={0} aria-label={`Open ${t.name}`} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }}>
                <div className="thead">
                  <TrackerMark t={t} />
                  <div className="tname"><b>{t.name}</b>{accountLine(S, t) && <span className="tsub">{accountLine(S, t)}</span>}</div>
                  <Pill cls={v.pill[1]} spin={v.spin}>{v.pill[0]}</Pill>
                </div>
                {hintShown(v) && <div className="hint">{v.hint}</div>}
                <div className="foot">
                  <span>{rules} rule{rules === 1 ? '' : 's'}{alerts > 0 && ` · ${alerts} recent alert${alerts === 1 ? '' : 's'}`}</span>
                  <span className="grow" />
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><Switch checked={t.enabled} onChange={(on) => setEnabled(t.id, on)} label={`Watch ${t.name}`} /></span>
                  <span className="go"><Icon name="left" size={15} /></span>
                </div>
            </div>
          );
        })}
      </div>
      {picking && <AddTrackerDialog onClose={() => setPicking(false)} onPick={(k) => { setPicking(false); setAdding(k.type); }} />}
      {adding === 'whatsapp' && <WhatsAppDialog onClose={() => setAdding(null)} />}
      {adding === 'email' && <TrackerDialog type="email" onSave={upsert} onClose={() => setAdding(null)} />}
    </>
  );
}
