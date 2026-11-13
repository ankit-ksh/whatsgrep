import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { newRule, priorityLabel } from '../rules';
import { Sentence } from '../sentence';
import { useApp } from '../store';
import type { RuleForm, State } from '../types';
import { Badge, Card, Empty, IconBtn } from '../ui';
import { clone } from '../util';

function Facts({ rule }: { rule: RuleForm }) {
  const { trackers } = useApp();
  const missing = rule.on.mode === 'names' ? rule.on.names.filter((n) => !trackers.some((t) => t.name.toLowerCase() === n.toLowerCase())) : [];
  return (
    <>
      <Sentence d={rule} trackers={trackers} />
      {missing.length > 0 && <p className="hint" style={{ color: 'var(--warn)' }}>{missing.join(', ')} no longer exists</p>}
    </>
  );
}

export function Rules() {
  const { S, setS, openEditor, ask, toast, guard } = useApp();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = S.rules.map((r, i) => [r, i] as const).filter(([r]) => !q || r.name.toLowerCase().includes(q));
  if (!S.configExists) return <Card><Empty title="No config yet" /></Card>;
  return (
    <>
      <div className="toolbar">
        <div className="search"><Icon name="search" /><input type="text" aria-label="Search rules" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <span style={{ flex: 1 }} />
        <IconBtn icon="plus" label="Add rule" cls="primary" onClick={() => openEditor(-1, newRule(S))} />
      </div>
      {!S.rules.length ? (
        <Card><div className="empty"><b>No rules yet</b></div></Card>
      ) : (
        <Card>
          {shown.length ? shown.map(([r, i]) => (
            <div className="rule" key={r.name}>
              <div className="info">
                <h3>{r.name}<Badge cls={'p-' + r.priority}>{priorityLabel(r.priority)}</Badge></h3>
                <Facts rule={r} />
              </div>
              <div className="acts">
                <IconBtn icon="edit" label="Edit rule" onClick={() => openEditor(i, clone(r))} />
                <button className="btn ghost icon" title="Duplicate" aria-label={'Duplicate ' + r.name} onClick={() => { const c = clone(r); c.name += ' copy'; openEditor(-1, c); }}><Icon name="copy" size={16} /></button>
                <button className="btn ghost icon" title="Delete" aria-label={'Delete ' + r.name} onClick={guard(async () => {
                  if (!(await ask({ title: `Delete “${r.name}”?`, body: 'This removes the rule from your config.', ok: 'Delete', danger: true }))) return;
                  setS(await api<State>('PUT', '/api/config', { rules: S.rules.filter((_, j) => j !== i) }));
                  toast('Rule deleted');
                })}><Icon name="trash" size={16} /></button>
              </div>
            </div>
          )) : <div className="empty">No rules match “{filter}”.</div>}
        </Card>
      )}
    </>
  );
}
