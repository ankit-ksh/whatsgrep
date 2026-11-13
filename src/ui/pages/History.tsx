import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { useApp } from '../store';
import type { MatchItem } from '../types';
import { Badge, Card, IconBtn } from '../ui';
import { ago, fmtTime } from '../util';

const RANGES: [string, string][] = [['all', 'Any time'], ['hour', 'Last hour'], ['day', 'Last 24 hours'], ['week', 'Last 7 days']];
const RANGE_MS: Record<string, number> = { hour: 3600e3, day: 86400e3, week: 7 * 86400e3 };
const METHOD_LABEL: Record<string, string> = { desktop: 'Desktop', devices: 'Devices', phone: 'Devices', ntfy: 'Devices' };
const PAGE = 25;
const trackerOf = (m: MatchItem) => m.tracker ?? 'WhatsApp';

function exportCsv(rows: MatchItem[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['time,tracker,from,rule,priority,delivered,failed,message', ...rows.map((m) => [new Date(m.t).toISOString(), trackerOf(m), m.chat, m.rule, m.priority, (m.sent ?? []).join('+'), (m.failed ?? []).map((f) => f.method).join('+'), m.text].map(esc).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'whatsgrep-notifications.csv';
  document.body.append(a); a.click(); a.remove();
}

function Delivery({ m }: { m: MatchItem }) {
  const out = [];
  if (m.dry) out.push(<Badge key="dry">Dry run</Badge>);
  (m.sent ?? []).forEach((x) => out.push(<Badge key={'s' + x} cls="ok">{METHOD_LABEL[x] ?? x}</Badge>));
  (m.failed ?? []).forEach((f) => out.push(<Badge key={'f' + f.method} cls="bad" title={f.error}>{(METHOD_LABEL[f.method] ?? f.method) + ' failed'}</Badge>));
  if (!out.length) out.push(<Badge key="log">Logged only</Badge>);
  return <div className="row-actions" style={{ gap: 4 }}>{out}</div>;
}

// Every match, newest first, with search and filters.
export function History() {
  const { S, markSeen, ask, toast, guard, refresh } = useApp();
  const [items, setItems] = useState<MatchItem[]>([]);
  const [f, setF] = useState({ q: '', rule: '', from: '', tracker: '', range: 'all', delivery: 'all' });
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => api<{ items: MatchItem[] }>('GET', '/api/notifications').then((r) => setItems(r.items));
  useEffect(() => { void load(); markSeen(); }, [S.matchTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof f) => (v: string) => { setF((o) => ({ ...o, [k]: v })); setPage(0); };
  const uniq = (get: (m: MatchItem) => string) => [...new Set(items.map(get))].sort((a, b) => a.localeCompare(b));
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const now = Date.now();
    const r = items.filter((m) => {
      if (f.rule && m.rule !== f.rule) return false;
      if (f.from && m.chat !== f.from) return false;
      if (f.tracker && trackerOf(m) !== f.tracker) return false;
      if (f.range !== 'all' && now - m.t > RANGE_MS[f.range]) return false;
      if (f.delivery === 'ok' && !(m.sent?.length && !m.failed?.length)) return false;
      if (f.delivery === 'failed' && !m.failed?.length) return false;
      if (f.delivery === 'dry' && !m.dry) return false;
      return !q || `${m.chat} ${m.rule} ${m.text} ${trackerOf(m)}`.toLowerCase().includes(q);
    });
    return sort === 'desc' ? r : r.slice().reverse();
  }, [items, f, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const select = (label: string, key: keyof typeof f, opts: [string, string][]) => (
    <select aria-label={label} value={f[key]} onChange={(e) => set(key)(e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  );
  const toggleRow = (key: string) => setOpen((o) => (o === key ? null : key));
  const multiTracker = new Set(items.map(trackerOf)).size > 1;

  return (
    <Card>
      <div className="filters">
        <div className="search"><Icon name="search" /><input type="text" aria-label="Search notifications" value={f.q} onChange={(e) => set('q')(e.target.value)} /></div>
        {select('Rule', 'rule', [['', 'All rules'], ...uniq((m) => m.rule).map((x): [string, string] => [x, x])])}
        {multiTracker && select('Tracker', 'tracker', [['', 'All trackers'], ...uniq(trackerOf).map((x): [string, string] => [x, x])])}
        {select('Chat or sender', 'from', [['', 'All senders'], ...uniq((m) => m.chat).map((x): [string, string] => [x, x])])}
        {select('Time range', 'range', RANGES)}
        {select('Delivery', 'delivery', [['all', 'Any delivery'], ['ok', 'Delivered'], ['failed', 'Failed'], ['dry', 'Dry run']])}
      </div>
      <div className="row-actions" style={{ justifyContent: 'space-between', padding: '0 16px 12px' }}>
        <span className="muted">{rows.length} of {items.length} notifications</span>
        <div className="row-actions">
          <IconBtn icon="download" label="Export CSV" onClick={() => exportCsv(rows)} />
          <IconBtn icon="trash" label="Clear history" disabled={!items.length} onClick={guard(async () => {
            if (!(await ask({ title: 'Clear notification history?', body: 'This deletes the saved list of past matches. It does not affect your rules.', ok: 'Clear history', danger: true }))) return;
            await api('POST', '/api/notifications/clear'); toast('History cleared'); await refresh(); await load();
          })} />
        </div>
      </div>
      {!rows.length ? (
        <div className="empty" style={{ borderTop: '1px solid var(--line)' }}>
          <b>{items.length ? 'No matches' : 'No notifications yet'}</b>
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="htable">
              <thead><tr>
                <th className="sortable" tabIndex={0} onClick={() => setSort((s) => (s === 'desc' ? 'asc' : 'desc'))} onKeyDown={(e) => { if (e.key === 'Enter') setSort((s) => (s === 'desc' ? 'asc' : 'desc')); }}>When {sort === 'desc' ? '↓' : '↑'}</th>
                <th>From</th><th>Rule</th><th>Message</th><th>Delivery</th>
              </tr></thead>
              <tbody>
                {slice.map((m) => {
                  const key = m.t + '|' + m.rule + '|' + m.chat;
                  const isOpen = open === key;
                  return (
                    <Fragment key={key}>
                      <tr className={'hrow' + (isOpen ? ' open' : '')} tabIndex={0} aria-expanded={isOpen} onClick={() => toggleRow(key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(key); } }}>
                        <td className="nowrap" title={fmtTime(m.t)}><div>{ago(m.t)}</div><div className="hint">{fmtTime(m.t)}</div></td>
                        <td><b>{m.chat}</b>{m.source === 'email' && <div className="hint">{trackerOf(m)}</div>}</td>
                        <td><Badge>{m.rule}</Badge></td>
                        <td className="msgcell">{m.text}</td>
                        <td><Delivery m={m} /></td>
                      </tr>
                      {isOpen && (
                        <tr className="detail"><td colSpan={5}>
                          <div className="fulltext">{m.text}</div>
                          {(m.failed ?? []).map((x) => <div key={x.method} className="hint" style={{ color: 'var(--danger)' }}>{(METHOD_LABEL[x.method] ?? x.method) + ': ' + x.error}</div>)}
                          <div className="hint">{fmtTime(m.t)} · priority {m.priority ?? 'default'}{m.source === 'email' ? ' · ' + trackerOf(m) : ''}</div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row-actions" style={{ justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
            <span className="muted">Page {cur + 1} of {pages}</span>
            <div className="row-actions">
              <IconBtn icon="left" label="Previous page" cls="" disabled={cur === 0} onClick={() => setPage(cur - 1)} />
              <IconBtn icon="right" label="Next page" cls="" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
