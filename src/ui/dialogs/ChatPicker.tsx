import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Chat, Entry, TrackerDef } from '../types';
import { Dialog, IconBtn, closeDialog } from '../ui';
import { ago, sleep } from '../util';

interface ChatData { at: number; chats: Chat[]; running: boolean; linked: boolean }
const SHOWN = 80;

// A chat is added by its name, as it shows in WhatsApp. One without a name is added by its number, or its id.
const entryFor = (c: Chat): Entry => c.name ? { kind: 'exact', value: c.name } : c.phone ? { kind: 'phone', value: c.phone } : { kind: 'exact', value: c.id };

function Row({ chat, list, onChange }: { chat: Chat; list: Entry[]; onChange: (next: Entry[]) => void }) {
  const { kind, value } = entryFor(chat);
  const at = list.findIndex((e) => e.kind === kind && e.value === value);
  const added = at >= 0;
  return (
    <div className={'pickrow' + (added ? ' added' : '')}>
      <div className="who">
        <b>{chat.name || (chat.phone ? '+' + chat.phone : chat.id)}</b>
        <span className="badge">{chat.group ? 'Group' : 'Contact'}</span>
        {chat.phone && chat.name && <span className="hint">+{chat.phone}</span>}
      </div>
      <IconBtn icon={added ? 'x' : 'plus'} label={added ? 'Remove' : 'Add'} cls={added ? '' : 'primary'} onClick={() => onChange(added ? list.filter((_, i) => i !== at) : [...list, { kind, value }])} />
    </div>
  );
}

// Search the chats of one WhatsApp tracker and add them to a rule in different ways.
export function ChatPicker({ tracker, list, onChange, onClose }: { tracker: TrackerDef; list: Entry[]; onChange: (next: Entry[]) => void; onClose: () => void }) {
  const { toast, guard } = useApp();
  const [data, setData] = useState<ChatData>({ at: 0, chats: [], running: false, linked: false });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const url = '/api/chats?tracker=' + encodeURIComponent(tracker.id);

  const refreshList = async (current: ChatData = data) => {
    if (!current.running) { toast('Start the tracker (and link WhatsApp) to load your chats.', { err: true }); return; }
    setLoading(true);
    try {
      await api('POST', '/api/chats/refresh', { tracker: tracker.id });
      for (let i = 0; i < 12; i++) {
        await sleep(800);
        const next = await api<ChatData>('GET', url);
        setData(next);
        if (next.at > current.at) break;
      }
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void api<ChatData>('GET', url).then((d) => { setData(d); if (d.linked && !d.chats.length) void guard(() => refreshList(d))(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const hits = useMemo(() => data.chats.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q.replace(/\D/g, '') || '\u0000')), [data.chats, q]);
  const note = !data.chats.length
    ? (data.running ? 'No chats loaded yet. Press “Refresh list”.' : 'Your chat list is not available yet. Start the tracker and link WhatsApp, then open this again.')
    : `${hits.length} of ${data.chats.length} chats${data.at ? ' · updated ' + ago(data.at) : ''}${hits.length > SHOWN ? ` · showing the first ${SHOWN}, type to narrow down` : ''}`;

  return (
    <Dialog className="picker" onClose={onClose}>
      <h3>Pick chats{tracker.name !== 'WhatsApp' ? ` from ${tracker.name}` : ''}</h3>
      <div className="row-actions" style={{ marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 200 }}><input type="text" aria-label="Search chats" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <IconBtn icon="refresh" label="Refresh list" cls="" busy={loading} onClick={() => void guard(() => refreshList())()} />
      </div>
      <div className="hint">{note}</div>
      <div className="pickrows">{hits.slice(0, SHOWN).map((c) => <Row key={c.id} chat={c} list={list} onChange={onChange} />)}</div>
      <div className="row-actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}><IconBtn icon="check" label="Done" cls="primary" onClick={closeDialog} /></div>
    </Dialog>
  );
}
