import { useState, type ReactNode } from 'react';
import { api } from './api';
import { LinkDialog } from './dialogs/LinkDialog';
import { Icon } from './icons';
import { useApp } from './store';
import type { State, TrackerDef, TrackerStatus } from './types';
import { Card, IconBtn, Pill, Switch } from './ui';
import { ago, errorText, fmtNumber, sleep } from './util';

export interface Manage { onEnable: (on: boolean) => void; onEdit: () => void; onRemove: () => void }

export const liveStatus = (S: State, id: string): TrackerStatus | undefined => (S.status?.running ? S.status.trackers?.find((x) => x.id === id) : undefined);

// Good news needs no sentence: only say something when there is something to do.
export const hintShown = (v: View) => !!v.hint && (v.pill[1] === 'bad' || v.pill[1] === 'warn');

export interface View { pill: [string, string]; spin?: boolean; title: ReactNode; hint: string }

// The line under a tracker's name: the number or address it watches, if there is one.
export const accountLine = (S: State, t: TrackerDef): string | null => {
  if (t.type === 'email') return t.user ?? null;
  const a = liveStatus(S, t.id)?.account ?? S.trackers.find((x) => x.id === t.id)?.account;
  return a?.number ? fmtNumber(a.number) + (a.name ? ' · ' + a.name : '') : null;
};

// The tracker's emblem: a tinted tile, green for WhatsApp and blue for mail.
export const TrackerMark = ({ t, size = 40 }: { t: TrackerDef; size?: number }) => <span className={'tmark ' + t.type} style={{ width: size, height: size }}><Icon name={t.type === 'whatsapp' ? 'chat' : 'mail'} size={Math.round(size * .5)} /></span>;

function whatsappView(S: State, t: TrackerDef, saved?: TrackerDef): View {
  const live = liveStatus(S, t.id);
  const account = live?.account ?? saved?.account ?? null;
  const who: ReactNode = account?.number
    ? <><strong style={{ fontSize: 17 }}>{fmtNumber(account.number)}</strong>{account.name && <span className="muted"> · {account.name}</span>}</>
    : <strong>{saved?.hasSession ? 'Linked account' : 'No WhatsApp account linked'}</strong>;
  if (!saved) return { pill: ['Not saved yet', 'warn'], title: who, hint: '' };
  if (!t.enabled) return { pill: ['Off', ''], title: who, hint: '' };
  if (live?.state === 'listening') {
    const checked = live.checkedAt ? ` · checked ${ago(live.checkedAt)}${live.waState && live.waState !== 'CONNECTED' ? ' (' + live.waState + ')' : ''}` : '';
    return { pill: ['Linked', 'ok'], title: who, hint: checked.replace(/^ · /, '') };
  }
  if (live?.state === 'reconnecting') return { pill: ['Retrying', 'warn'], title: who, hint: live.error ?? 'Lost the connection.' };
  if (live && ['starting', 'linking', 'waiting for QR scan'].includes(live.state)) {
    return { pill: [live.state === 'waiting for QR scan' ? 'Waiting for scan' : 'Connecting…', 'warn'], spin: live.state !== 'waiting for QR scan', title: who, hint: live.error ?? 'Connecting…' };
  }
  if (live?.state === 'error') return { pill: ['Problem', 'bad'], title: who, hint: live.error ?? 'Could not start.' };
  if (live?.state === 'needs login' || !saved.hasSession) return { pill: ['Not linked', 'bad'], title: who, hint: live?.error ?? '' };
  return { pill: ['Linked · tracker stopped', 'warn'], title: who, hint: saved.account ? '' : '' };
}

function emailView(S: State, t: TrackerDef, saved?: TrackerDef): View {
  const live = liveStatus(S, t.id);
  const title = <><strong style={{ fontSize: 15 }}>{t.user}</strong><span className="muted"> · {(t.folders ?? ['INBOX']).join(', ')}</span></>;
  if (!saved) return { pill: ['Not saved yet', 'warn'], title, hint: '' };
  if (!t.enabled) return { pill: ['Off', ''], title, hint: '' };
  if (!saved.hasPassword && !live) return { pill: ['No password', 'bad'], title, hint: '' };
  if (live?.state === 'listening') return { pill: ['Connected', 'ok'], title, hint: '' };
  if (live?.state === 'error') return { pill: ['Problem', 'bad'], title, hint: live.error ?? 'Could not connect.' };
  if (live) return { pill: ['Connecting…', 'warn'], spin: true, title, hint: live.error ?? 'Connecting to the mail server…' };
  return { pill: ['Tracker stopped', 'warn'], title, hint: '' };
}

export const trackerView = (S: State, t: TrackerDef): View => {
  const saved = S.trackers.find((x) => x.id === t.id);
  return t.type === 'whatsapp' ? whatsappView(S, t, saved) : emailView(S, t, saved);
};

// One tracker: who or what it watches, whether it works, and what you can do with it.
export function TrackerCard({ t, manage }: { t: TrackerDef; manage?: Manage }) {
  const { S, refresh, toast, ask, guard } = useApp();
  const [linking, setLinking] = useState(false);
  const [working, setWorking] = useState('');
  const saved = S.trackers.find((x) => x.id === t.id);
  const isWA = t.type === 'whatsapp';
  const v = isWA ? whatsappView(S, t, saved) : emailView(S, t, saved);
  const live = liveStatus(S, t.id);
  // Check and log out only make sense on a live connection; anything else offers the QR login.
  const linked = isWA && live?.state === 'listening';

  const check = guard(async () => {
    setWorking('check');
    try {
      const before = live?.checkedAt ?? 0;
      const r = await api<{ running?: boolean }>('POST', '/api/tracker/command', { action: 'check', tracker: t.id });
      if (!r.running) { toast('The tracker is stopped, so the live connection cannot be checked. The saved account is still there.'); return; }
      let now = live;
      for (let i = 0; i < 8; i++) { await sleep(800); now = liveStatus(await refresh(), t.id); if ((now?.checkedAt ?? 0) > before) break; }
      const ok = now?.waState === 'CONNECTED';
      toast(ok ? 'WhatsApp is connected.' : `WhatsApp reports: ${now?.waState ?? 'no answer'}`, { err: !ok });
    } finally { setWorking(''); }
  });

  const logout = guard(async () => {
    const running = S.status?.running;
    if (!(await ask({ title: `Log out of ${t.name}?`, body: running ? 'whatsgrep will unlink this device. You will need to scan a QR code to link again.' : 'This removes the saved session from this computer. You will need to scan a QR code to link again.', ok: 'Log out', danger: true }))) return;
    const r = await api<{ message?: string }>('POST', '/api/tracker/command', { action: 'logout', tracker: t.id });
    if (r.message) toast(r.message);
    for (let i = 0; i < 12; i++) { await sleep(1000); const s = await refresh(); if (!s.trackers.find((x) => x.id === t.id)?.account && !liveStatus(s, t.id)?.account) break; }
  });

  const testMail = guard(async () => {
    setWorking('test');
    try {
      const r = await api<{ ok: boolean; messages?: number; error?: string }>('POST', '/api/email/test', { id: t.id, user: t.user, provider: t.provider, host: t.host, port: t.port, folder: t.folders?.[0] });
      toast(r.ok ? `Connected. ${t.folders?.[0] ?? 'INBOX'} has ${r.messages} messages.` : (r.error ?? 'Could not connect.'), { err: !r.ok });
    } catch (e) { toast(errorText(e), { err: true }); } finally { setWorking(''); }
  });

  return (
    <Card off={manage && !t.enabled}>
      <div className="trow">
        <TrackerMark t={t} />
        <div className="tname"><b>{t.name}</b>{accountLine(S, t) && <span className="tsub">{accountLine(S, t)}</span>}</div>
        <div className="tstate"><Pill cls={v.pill[1]} spin={v.spin}>{v.pill[0]}</Pill></div>
        <div className="ctl">
          {isWA && saved && t.enabled && !linked && <button className="btn primary" onClick={() => setLinking(true)}><Icon name="qr" size={16} />Link WhatsApp</button>}
          {isWA && saved && t.enabled && linked && <IconBtn icon="refresh" label="Check status" cls="" busy={working === 'check'} onClick={() => void check()} />}
          {isWA && saved && t.enabled && (linked || saved.hasSession) && <IconBtn icon="logout" label="Log out" cls="ghost" onClick={() => void logout()} />}
          {!isWA && saved?.hasPassword && t.enabled && <IconBtn icon="plug" label="Test connection" cls="" busy={working === 'test'} onClick={() => void testMail()} />}
          {manage && <IconBtn icon="edit" label={'Edit ' + t.name} onClick={manage.onEdit} />}
          {manage && <IconBtn icon="trash" label={'Remove ' + t.name} onClick={manage.onRemove} />}
          {manage && <Switch checked={t.enabled} onChange={manage.onEnable} label={`Watch ${t.name}`} />}
        </div>
        {hintShown(v) && <div className="hint thint">{v.hint}</div>}
      </div>
      {linking && <LinkDialog t={t} onClose={() => setLinking(false)} />}
    </Card>
  );
}
