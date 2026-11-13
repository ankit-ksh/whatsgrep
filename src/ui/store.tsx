import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Pending, RuleForm, State, Tab, TrackerDef } from './types';
import { clone, errorText, same, sleep } from './util';

export interface ToastItem { id: number; msg: string; err?: boolean; action?: { label: string; fn: () => void } }
export interface AskOpts { title: string; body: string; ok?: string; danger?: boolean }
export interface Editing { index: number; draft: RuleForm; original: RuleForm }
type Busy = null | 'starting' | 'stopping' | 'restarting';
export interface TrackerSummary { label: string; cls: string; spin?: boolean; key: 'stopping' | 'starting' | 'listening' | 'qr' | 'login' | 'down' | 'off' }

export interface App {
  S: State;
  setS: (s: State) => void;
  refresh: () => Promise<State>;
  tab: Tab;
  go: (t: Tab) => Promise<void>;
  trackerId: string | null;
  openTracker: (id: string | null) => Promise<void>;
  pending: Pending;
  pendingKeys: string[];
  val: <K extends keyof Pending>(k: K) => Pending[K];
  stage: <K extends keyof Pending>(k: K, v: Pending[K]) => void;
  discard: () => void;
  savePending: () => Promise<void>;
  saving: boolean;
  busy: Busy;
  tracker: TrackerSummary;
  control: (a: 'start' | 'stop' | 'restart') => Promise<void>;
  toast: (msg: string, o?: { err?: boolean; action?: ToastItem['action'] }) => void;
  toasts: ToastItem[];
  ask: (o: AskOpts) => Promise<boolean>;
  confirmReq: { opts: AskOpts; done: (yes: boolean) => void } | null;
  guard: <A extends unknown[]>(fn: (...a: A) => Promise<unknown> | unknown) => (...a: A) => Promise<void>;
  editing: Editing | null;
  editorDirty: boolean;
  openEditor: (index: number, draft: RuleForm) => void;
  setDraft: (d: RuleForm) => void;
  saveRule: () => Promise<void>;
  seenAt: number;
  markSeen: () => void;
  unread: number;
  trackers: TrackerDef[];
}

const Ctx = createContext<App | null>(null);
export function useApp(): App {
  const a = useContext(Ctx);
  if (!a) throw new Error('outside the app');
  return a;
}

const CONFIG_KEYS = ['notifications', 'repeatWindowHours', 'browser'] as const;
// What the page edits of a tracker, without the live details the server adds.
export const editable = (t: TrackerDef): TrackerDef => ({ id: t.id, name: t.name, type: t.type, enabled: t.enabled, user: t.user, provider: t.provider, host: t.host, port: t.port, folders: t.folders });

function summarize(S: State, busy: Busy): TrackerSummary {
  const s = S.status;
  const up = s?.running;
  if (busy === 'stopping') return { label: 'Stopping…', cls: 'warn', spin: true, key: 'stopping' };
  if (busy === 'restarting') return { label: 'Restarting…', cls: 'warn', spin: true, key: 'starting' };
  if (up && s.state === 'listening') return { label: 'Listening', cls: 'ok', key: 'listening' };
  if (up && s.state === 'waiting for QR scan') return { label: 'Link WhatsApp', cls: 'warn', key: 'qr' };
  if (up && s.state === 'error') return { label: 'Problem', cls: 'bad', key: 'down' };
  if (up && s.state === 'needs login') return { label: 'Needs login', cls: 'bad', key: 'login' };
  if (up && s.state === 'idle') return { label: 'Nothing to watch', cls: 'bad', key: 'down' };
  if (up && s.state === 'starting' && Date.now() - s.startedAt > 45000) return { label: 'Not responding', cls: 'bad', key: 'down' };
  if (up && (s.state === 'starting' || s.state === 'linking')) return { label: s.state === 'linking' ? 'Linking…' : 'Starting…', cls: 'warn', spin: true, key: 'starting' };
  if (up) return { label: 'Running', cls: 'warn', key: 'down' };
  if (busy === 'starting') return { label: 'Starting…', cls: 'warn', spin: true, key: 'starting' };
  if (s?.state === 'needs login') return { label: 'Needs login', cls: 'bad', key: 'login' };
  if (s?.state === 'disconnected') return { label: 'Disconnected', cls: 'bad', key: 'down' };
  return { label: 'Not running', cls: '', key: 'off' };
}

export function AppProvider({ initial, children }: { initial: State; children: ReactNode }) {
  const [S, setSState] = useState(initial);
  const sRef = useRef(S);
  const setS = useCallback((s: State) => { sRef.current = s; setSState(s); }, []);
  const [tab, setTab] = useState<Tab>(() => {
    const t = location.hash.slice(1).split('/')[0] as Tab;
    return ['overview', 'notifications', 'rules', 'trackers', 'delivery', 'settings', 'advanced', 'help'].includes(t) ? t : 'overview';
  });
  const [trackerId, setTrackerId] = useState<string | null>(() => (location.hash.startsWith('#trackers/') ? decodeURIComponent(location.hash.slice(10)) : null));
  // The address follows the page, so a reload or a copied link lands where you were.
  useEffect(() => { history.replaceState(null, '', '#' + tab + (tab === 'trackers' && trackerId ? '/' + encodeURIComponent(trackerId) : '')); }, [tab, trackerId]);
  const [pending, setPending] = useState<Pending>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef<Busy>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmReq, setConfirmReq] = useState<App['confirmReq']>(null);
  const [editing, setEditing] = useState<Editing | null>(() => {
    const m = /^#rules\/(\d+)$/.exec(location.hash);
    const rule = m ? initial.rules[Number(m[1])] : undefined;
    return rule ? { index: Number(m![1]), draft: clone(rule), original: clone(rule) } : null;
  });
  const [seenAt, setSeenAt] = useState(() => {
    try { const v = Number(localStorage.getItem('wg-seen')); if (v) return v; localStorage.setItem('wg-seen', String(Date.now())); } catch { /* storage can be blocked */ }
    return Date.now();
  });

  const setBusyBoth = (b: Busy) => { busyRef.current = b; setBusy(b); };
  const refresh = useCallback(async () => { const s = await api<State>('GET', '/api/state'); setS(s); return s; }, [setS]);

  // ---- toasts and confirmations --------------------------------------------
  const toast = useCallback<App['toast']>((msg, o = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err: o.err, action: o.action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), o.err ? 7000 : o.action ? 9000 : 3200);
  }, []);
  const guard = useCallback<App['guard']>((fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(errorText(e), { err: true }); } }, [toast]);
  const ask = useCallback<App['ask']>((opts) => new Promise((resolve) => setConfirmReq({ opts, done: (yes) => { setConfirmReq(null); resolve(yes); } })), []);

  // ---- staged settings -----------------------------------------------------
  const base = (k: keyof Pending): unknown => ({
    notifications: S.config?.notifications, repeatWindowHours: S.config?.repeatWindowHours,
    browser: S.config?.browser, runAtLogin: S.runAtLogin, trackers: S.trackers.map(editable), passwords: undefined,
  })[k];
  const val = <K extends keyof Pending>(k: K): Pending[K] => (k in pending ? pending[k] : base(k)) as Pending[K];
  const stage = <K extends keyof Pending>(k: K, v: Pending[K]) => {
    setPending((p) => {
      const next = { ...p };
      const nv = k === 'repeatWindowHours' && v !== '' ? Number(v) : v;
      if (same(nv, base(k)) || (k === 'passwords' && !Object.keys((nv ?? {}) as object).length)) delete next[k]; else (next as Record<string, unknown>)[k] = nv;
      return next;
    });
  };
  const pendingKeys = Object.keys(pending);
  const discard = () => setPending({});
  const trackers = pending.trackers ?? S.trackers;

  // ---- tracker process: start, stop, restart, with a real "starting" phase ------
  const tracker = useMemo(() => summarize(S, busy), [S, busy]);
  const pollingRef = useRef(false);
  const pollUntilSettled = useCallback(async (since: number) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      while (busyRef.current) {
        await sleep(1000);
        const s = await refresh();
        const up = s.status?.running, state = s.status?.state, waited = Date.now() - since;
        const starting = busyRef.current === 'starting' || busyRef.current === 'restarting';
        if (busyRef.current === 'stopping' && !up) setBusyBoth(null);
        else if (starting && up && waited > 1500 && ['listening', 'waiting for QR scan', 'needs login', 'error', 'idle'].includes(state ?? '')) setBusyBoth(null);
        else if (starting && up && waited > 20000) setBusyBoth(null);
        else if (starting && !up && waited > 5000 && ['needs login', 'disconnected'].includes(state ?? '')) {
          setBusyBoth(null);
          toast(state === 'needs login' ? 'WhatsApp needs to be linked again.' : 'It stopped right after starting. See Advanced → Log.', { err: true });
        } else if (starting && !up && waited > 10000) { setBusyBoth(null); toast('It did not start. Open Advanced → Log to see why.', { err: true }); }
        else if (waited > 90000) setBusyBoth(null);
      }
    } finally { pollingRef.current = false; }
  }, [refresh, toast]);

  const control = useCallback<App['control']>(async (action) => {
    if (action !== 'stop' && !sRef.current.trackers.some((t) => t.enabled)) { toast('Nothing to watch. Add a tracker, or turn one on.', { err: true }); return; }
    setBusyBoth(action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'restarting');
    const since = Date.now();
    try {
      const r = await api<{ message?: string }>('POST', '/api/tracker', { action });
      if (r.message && !['started', 'stopped'].includes(r.message)) toast(r.message);
    } catch (e) { setBusyBoth(null); throw e; }
    void pollUntilSettled(since);
  }, [pollUntilSettled, toast]);

  // ---- notification history helpers --------------------------------------
  const markSeen = useCallback(() => {
    const now = Date.now();
    setSeenAt(now);
    try { localStorage.setItem('wg-seen', String(now)); } catch { /* storage can be blocked */ }
  }, []);
  const unread = S.recentMatches.filter((m) => !m.dry && m.t > seenAt).length;

  // ---- save ------------------------------------------------------------------
  const savePending = async () => {
    setSaving(true);
    const configKeys = CONFIG_KEYS.filter((k) => k in pending);
    const wantLogin = 'runAtLogin' in pending ? pending.runAtLogin ?? null : null;
    try {
      const body: Record<string, unknown> = Object.fromEntries(configKeys.map((k) => [k, pending[k]]));
      if (pending.trackers) {
        body.trackers = pending.trackers;
        // Rules point at trackers by name: keep them pointing at the same tracker after a rename.
        const renamed = new Map(S.trackers.flatMap((o) => { const n = pending.trackers!.find((x) => x.id === o.id); return n && n.name !== o.name ? [[o.name, n.name] as const] : []; }));
        if (renamed.size) {
          const rules = clone(S.rules);
          for (const r of rules) r.on.names = r.on.names.map((n) => renamed.get(n) ?? n);
          body.rules = rules;
        }
      }
      if (Object.keys(body).length) setS(await api<State>('PUT', '/api/config', body));
      for (const [id, password] of Object.entries(pending.passwords ?? {})) await api('PUT', '/api/tracker/password', { id, password });
      for (const gone of S.trackers.filter((o) => o.type === 'email' && pending.trackers && !pending.trackers.some((x) => x.id === o.id))) await api('POST', '/api/tracker/forget', { id: gone.id });
      if (wantLogin !== null) {
        if (wantLogin) setBusyBoth('starting');
        const r = await api<{ message: string }>('POST', '/api/run-at-login', { enabled: wantLogin });
        toast(r.message.split('\n')[0] || 'Done');
      }
    } catch (e) { setBusyBoth(null); setSaving(false); throw e; }
    await refresh().catch(() => {});
    setPending({});
    setSaving(false);
    if (wantLogin) void pollUntilSettled(Date.now());
    else if (wantLogin === null) toast(pending.trackers ? 'Saved. Trackers are applied right away.' : 'Saved');
  };

  // ---- rule editor -------------------------------------------------------------
  const editorDirty = !!editing && !same(editing.draft, editing.original);
  const openEditor = (index: number, draft: RuleForm) => { setTrackerId(null); setEditing({ index, draft, original: clone(draft) }); setTab('rules'); window.scrollTo(0, 0); };
  const setDraft = (draft: RuleForm) => setEditing((e) => (e ? { ...e, draft } : e));
  const saveRule = async () => {
    if (!editing) return;
    const rules = clone(S.rules);
    if (editing.index < 0) rules.push(editing.draft); else rules[editing.index] = editing.draft;
    setS(await api<State>('PUT', '/api/config', { rules }));
    setEditing(null);
    toast('Rule saved. A running tracker uses it right away.');
  };

  const go = async (next: Tab) => {
    if (editorDirty && !(await ask({ title: 'Discard this rule?', body: 'You have unsaved changes to this rule.', ok: 'Discard', danger: true }))) return;
    setEditing(null);
    setTrackerId(null);
    setTab(next);
  };
  // Open one tracker's page (null goes back to the list).
  const openTracker = async (id: string | null) => {
    await go('trackers');
    setTrackerId(id);
    window.scrollTo(0, 0);
  };

  // ---- keep status fresh; browser guards ------------------------------------------
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden || busyRef.current) return;
      try {
        const next = await api<State>('GET', '/api/state');
        const cur = sRef.current;
        if (JSON.stringify(next.status) !== JSON.stringify(cur.status) || next.matchTotal !== cur.matchTotal || next.runAtLogin !== cur.runAtLogin) setS(next);
      } catch { /* the next tick tries again */ }
    }, 2500);
    return () => clearInterval(id);
  }, [setS]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pendingKeys.length || editorDirty) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  });

  const value: App = {
    S, setS, refresh, tab, go, trackerId, openTracker, pending, pendingKeys, val, stage, discard, savePending, saving, busy, tracker, control,
    toast, toasts, ask, confirmReq, guard, editing, editorDirty, openEditor, setDraft, saveRule, seenAt, markSeen, unread, trackers,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
