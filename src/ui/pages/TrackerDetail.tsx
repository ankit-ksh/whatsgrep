import { useState } from 'react';
import { TrackerDialog } from '../dialogs/TrackerDialog';
import { priorityLabel, ruleTrackers } from '../rules';
import { useApp } from '../store';
import { TrackerCard } from '../TrackerCard';
import { useTrackerEdits } from '../trackerEdits';
import { Badge, Card, CardHead, Empty, IconBtn } from '../ui';
import { clone } from '../util';
import { MatchRow } from '../shell';

// Everything about one tracker: its state and controls, what it watches, the rules that use it and what it caught.
export function TrackerDetail({ id }: { id: string }) {
  const { S, trackers, openTracker, openEditor, go } = useApp();
  const { upsert, setEnabled, forDialog, remove } = useTrackerEdits();
  const [editing, setEditing] = useState(false);
  const t = trackers.find((x) => x.id === id);
  if (!t) return <Card><Empty title="This tracker is gone"><IconBtn icon="left" label="Back to trackers" cls="" onClick={() => void openTracker(null)} /></Empty></Card>;

  const rules = S.rules.map((r, i) => ({ r, i })).filter(({ r }) => ruleTrackers(r, trackers).some((x) => x.id === id));
  const alerts = S.recentMatches.filter((m) => !m.dry && m.tracker === t.name).slice(0, 8);
  const isWA = t.type === 'whatsapp';
  const host = t.host ? `${t.host}${t.port ? ':' + t.port : ''}` : (S.providers.find((p) => p.id === t.provider)?.host ?? '');

  return (
    <>
      <TrackerCard t={t} manage={{
        onEnable: (on) => setEnabled(t.id, on),
        onEdit: () => setEditing(true),
        onRemove: () => void remove(t).then((gone) => { if (gone) void openTracker(null); }),
      }} />

      {!isWA && (
        <Card>
          <CardHead title="Server" />
          <div className="body"><div className="kvlist">
            <span className="k">Mail server</span><span className="v">{host || 'Automatic'}</span>
            <span className="k">Folders</span><span className="v">{(t.folders?.length ? t.folders : ['INBOX']).join(', ')}</span>
          </div></div>
        </Card>
      )}

      <Card>
        <CardHead title="Rules" desc={rules.length ? undefined : 'None yet'} action={<IconBtn icon="right" label="All rules" cls="" onClick={() => void go('rules')} />} />
        {rules.map(({ r, i }) => (
          <div key={i} className="lrow">
            <div className="grow"><b>{r.name}</b></div>
            <Badge>{priorityLabel(r.priority)}</Badge>
            <IconBtn icon="edit" label="Edit rule" onClick={() => openEditor(i, clone(r))} />
          </div>
        ))}
      </Card>

      <Card>
        <CardHead title="Recent alerts" desc={alerts.length ? undefined : 'None yet'} action={<IconBtn icon="right" label="All notifications" cls="" onClick={() => void go('notifications')} />} />
        {alerts.map((m) => <MatchRow key={m.t + m.rule} m={m} />)}
      </Card>

      {editing && <TrackerDialog key={t.id} type={t.type} initial={forDialog(t)} onSave={upsert} onClose={() => setEditing(false)} />}
    </>
  );
}
