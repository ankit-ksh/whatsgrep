import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, qrImage } from '../api';
import { Icon } from '../icons';
import { useApp } from '../store';
import type { State, TrackerDef, TrackerStatus } from '../types';
import { Dialog, IconBtn, Spinner } from '../ui';
import { fmtNumber, sleep } from '../util';

export const STAGES = ['Start the tracker', 'Open WhatsApp Web', 'Get the login code', 'Scan with your phone'];

export type LinkView =
  | { kind: 'wait'; msg: string; stage: number }
  | { kind: 'qr'; src: string | null }
  | { kind: 'done'; number?: string }
  | { kind: 'fail'; title: string; detail: string; log: string };

// Links one WhatsApp tracker: starts the tracker if needed, asks it for a login code, shows real
// progress and reports when linked. It runs once per tracker (and per "try again"), however often
// the page around it redraws.
export function useLinkFlow(t: TrackerDef | null, onLinked?: (number?: string) => void) {
  const { refresh } = useApp();
  const [view, setView] = useState<LinkView>({ kind: 'wait', msg: 'Starting…', stage: 0 });
  const [attempt, setAttempt] = useState(0);
  const linked = useRef(onLinked);
  linked.current = onLinked;
  const id = t?.id;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      const fail = async (title: string, detail: string) => {
        const log = (await api<{ text: string }>('GET', '/api/log').catch(() => ({ text: '' }))).text.trim().split('\n').slice(-8).join('\n');
        if (alive) setView({ kind: 'fail', title, detail, log });
      };
      setView({ kind: 'wait', msg: 'Starting…', stage: 0 });
      let s: State | undefined = await refresh().catch(() => undefined);
      if (!s?.status?.running) await api('POST', '/api/tracker', { action: 'start' });
      const started = Date.now();
      let shown: string | undefined;
      // The tracker only listens for "log in" once it is up and has this account, so ask when it is
      // there, and ask again if it is still waiting to be asked a few seconds later.
      let asked = 0, askedAt = 0;
      const ask = async () => {
        const r = await api<{ running?: boolean }>('POST', '/api/tracker/command', { action: 'login', tracker: id }).catch(() => ({ running: false }));
        if (r.running) { asked++; askedAt = Date.now(); }
      };
      while (alive) {
        await sleep(1000);
        s = await refresh().catch(() => s);
        if (!alive || !s) return;
        const waited = Date.now() - started;
        const live: TrackerStatus | undefined = s.status?.running ? s.status.trackers?.find((x) => x.id === id) : undefined;
        if (live && !live.qr && (!asked || (live.state === 'needs login' && asked < 4 && Date.now() - askedAt > 5000))) await ask();
        if (live && (live.account || live.state === 'listening')) {
          setView({ kind: 'done', number: live.account?.number });
          linked.current?.(live.account?.number);
          return;
        }
        if (live?.qr) {
          if (live.qr !== shown) { shown = live.qr; const src = await qrImage(id); if (alive) setView({ kind: 'qr', src }); }
          continue;
        }
        if (live?.state === 'linking') { setView({ kind: 'wait', msg: 'Linking your account…', stage: 3 }); continue; }
        if (live?.state === 'error') return fail('Could not start', live.error ?? 'WhatsApp could not be started.');
        if (live && live.state !== 'needs login') {
          const stage = waited > 6000 ? 2 : 1;
          setView({ kind: 'wait', msg: stage === 2 ? 'Waiting for WhatsApp to show a code…' : 'Opening WhatsApp Web…', stage });
          if (waited > 75000) return fail('This is taking too long', 'WhatsApp Web did not show a code in time. Check your internet connection, then try again.');
          continue;
        }
        if (waited > 12000) return fail('The tracker stopped', live ? 'WhatsApp needs a fresh link. Try again.' : 'It exited before showing a code. The last log lines are below.');
      }
    })().catch((e) => { if (alive) setView({ kind: 'fail', title: 'Something went wrong', detail: e instanceof Error ? e.message : String(e), log: '' }); });
    return () => { alive = false; };
  }, [id, attempt, refresh]);

  return { view, retry: () => setAttempt((a) => a + 1) };
}

export const Stages = ({ active, waiting = false }: { active: number; waiting?: boolean }) => (
  <ul className="stages">
    {STAGES.map((label, i) => (
      <li key={label} className={i < active ? 'done' : i === active ? 'now' : ''}>
        <span className="sd">{i < active ? <Icon name="check" size={13} /> : i === active && !waiting ? <Spinner /> : null}</span><span>{label}</span>
      </li>
    ))}
  </ul>
);

// The square: a spinner, the code, a tick or a warning.
export function LinkBox({ view }: { view: LinkView }): ReactNode {
  if (view.kind === 'wait') return <><span className="spin" style={{ width: 34, height: 34, borderWidth: 3, color: 'var(--accent)' }} /><div className="muted" style={{ marginTop: 12, fontSize: 13 }}>{view.msg}</div></>;
  if (view.kind === 'qr') return view.src ? <img className="qr" alt="WhatsApp login QR code" src={view.src} /> : <Spinner />;
  if (view.kind === 'done') return <span className="bigicon ok"><Icon name="check" size={30} /></span>;
  return <span className="bigicon bad"><Icon name="alert" size={28} /></span>;
}

// What to do next, beside or under the square.
export function LinkSide({ view, retry, onLog }: { view: LinkView; retry: () => void; onLog: () => void }): ReactNode {
  if (view.kind === 'wait') return <><h4>Getting things ready</h4><Stages active={view.stage} /></>;
  if (view.kind === 'qr') return <><h4>Scan this code</h4><Stages active={3} waiting /><ol className="how"><li>Open WhatsApp on your phone</li><li>Settings → Linked devices</li><li>Link a device, then scan</li></ol></>;
  if (view.kind === 'done') return <><h4>WhatsApp is linked</h4><p className="hint">{view.number ? fmtNumber(view.number) : ''}</p></>;
  return (
    <>
      <h4>{view.title}</h4><p className="hint">{view.detail}</p>
      {view.log && <pre className="log" style={{ maxHeight: 140, fontSize: 12 }}>{view.log}</pre>}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <IconBtn icon="refresh" label="Try again" cls="primary" onClick={retry} />
        <IconBtn icon="code" label="Open full log" cls="" onClick={onLog} />
      </div>
    </>
  );
}

// The popup for one existing tracker. Closes itself shortly after linking.
export function LinkDialog({ t, onClose }: { t: TrackerDef; onClose: () => void }) {
  const { go } = useApp();
  const { view, retry } = useLinkFlow(t, () => { setTimeout(onClose, 1400); });
  return (
    <Dialog className="linkdlg" onClose={onClose}>
      <div className="ld-head"><h3>Link {t.name}</h3></div>
      <div className="ld-body">
        <div className="ld-box"><LinkBox view={view} /></div>
        <div className="ld-side"><LinkSide view={view} retry={retry} onLog={() => { onClose(); void go('advanced'); }} /></div>
      </div>
    </Dialog>
  );
}
