import { Component, useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { Spinner, Dialog, IconBtn } from './ui';
import { useApp } from './store';
import type { MatchItem, Tab } from './types';
import { ago } from './util';
import { validity } from './rules';
import { Advanced } from './pages/Advanced';
import { Delivery } from './pages/Delivery';
import { Help } from './pages/Help';
import { History } from './pages/History';
import { Overview } from './pages/Overview';
import { RuleEditor } from './pages/RuleEditor';
import { Rules } from './pages/Rules';
import { Settings } from './pages/Settings';
import { Trackers } from './pages/Trackers';
import { TrackerDetail } from './pages/TrackerDetail';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'rules', label: 'Rules', icon: 'rules' },
  { id: 'trackers', label: 'Trackers', icon: 'radar' },
  { id: 'delivery', label: 'Delivery', icon: 'send' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
  { id: 'advanced', label: 'Advanced', icon: 'code' },
  { id: 'help', label: 'Help', icon: 'help' },
];
const TAB_KEYS: Partial<Record<Tab, string[]>> = {
  delivery: ['notifications'],
  settings: ['repeatWindowHours', 'browser', 'runAtLogin'],
  trackers: ['trackers', 'passwords'],
};

export function MatchRow({ m }: { m: MatchItem }) {
  return (
    <div className="rmatch">
      <div className="top"><b>{m.chat}</b><span className="when">{ago(m.t)}</span></div>
      <div><span className="badge">{m.rule}</span>{m.tracker && m.source === 'email' && <> <span className="badge">{m.tracker}</span></>}</div>
      <div className="txt">{m.text}</div>
    </div>
  );
}

function useTheme() {
  const [theme, setTheme] = useState<string | null>(() => { try { return localStorage.getItem('wg-theme'); } catch { return null; } });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  }, [theme]);
  const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('wg-theme', next); } catch { /* storage can be blocked */ }
  };
  return { dark, toggle };
}

function Bell() {
  const { S, unread, seenAt, markSeen, go } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!(e.target as Element).closest('#bellpop, #bell')) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key); };
  }, [open]);
  const items = S.recentMatches.filter((m) => !m.dry).slice(0, 6);
  return (
    <>
      <button id="bell" className="btn ghost icon bell" title="Notifications" aria-haspopup="true" aria-label={unread ? `${unread} new notifications` : 'Notifications'} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <Icon name="bell" size={19} />{unread > 0 && <span className="bellcount">{unread >= 20 ? '20+' : unread}</span>}
      </button>
      {open && (
        <div className="bellpop" id="bellpop">
          <div className="ph"><b>Notifications</b><IconBtn icon="check" label="Mark all read" onClick={markSeen} /></div>
          {items.length ? <div>{items.map((m) => <div key={m.t + m.rule} className={m.t > seenAt ? 'new' : ''}><MatchRow m={m} /></div>)}</div> : <div className="empty" style={{ padding: 24 }}>No notifications yet.</div>}
          <div className="rfoot"><IconBtn icon="right" label="View all notifications" cls="" onClick={() => { setOpen(false); markSeen(); void go('notifications'); }} /></div>
        </div>
      )}
    </>
  );
}

function SaveBar() {
  const { editing, editorDirty, pendingKeys, discard, savePending, saving, saveRule, go, guard } = useApp();
  if (editing) {
    const why = validity(editing.draft);
    return (
      <div className="savebar"><div>
        <span className={'msg' + (!editorDirty && !why ? ' ok' : '')}>{why ?? (editorDirty ? 'Unsaved changes' : 'No changes')}</span>
        <IconBtn icon="x" label="Cancel" onClick={() => void go('rules')} />
        <button className="btn primary" disabled={!!why || !editorDirty} onClick={guard(saveRule)}>Save</button>
      </div></div>
    );
  }
  if (!pendingKeys.length) return null;
  const n = pendingKeys.length;
  return (
    <div className="savebar"><div>
      <span className="msg">{`${n} unsaved change${n > 1 ? 's' : ''}`}</span>
      <IconBtn icon="undo" label="Discard changes" onClick={discard} />
      <button className="btn primary" disabled={saving} onClick={guard(savePending)}>{saving ? <><Spinner />Saving…</> : 'Save'}</button>
    </div></div>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={'toast' + (t.err ? ' err' : '')} role="status"><span>{t.msg}</span>{t.action && <button onClick={t.action.fn}>{t.action.label}</button>}</div>)}
    </div>
  );
}

function ConfirmHost() {
  const { confirmReq } = useApp();
  if (!confirmReq) return null;
  const { opts, done } = confirmReq;
  return (
    <Dialog onClose={() => done(false)}>
      <h3>{opts.title}</h3><p>{opts.body}</p>
      <div className="row-actions">
        <button className="btn" onClick={() => done(false)}>Cancel</button>
        <button className={'btn ' + (opts.danger ? 'danger' : 'primary')} onClick={() => done(true)}>{opts.ok ?? 'Confirm'}</button>
      </div>
    </Dialog>
  );
}

// A page that fails shows its error instead of taking the whole app down with it.
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="alert bad"><Icon name="alert" /><div><b>Something went wrong on this page</b><span>{this.state.error.message}</span></div></div>;
  }
}

// Where you are: Overview / Section / Item. Every earlier step goes back.
function Crumbs() {
  const { S, tab, go, openTracker, trackerId, trackers, editing } = useApp();
  const label = TABS.find((t) => t.id === tab)!.label;
  const trail: { text: string; to?: () => void }[] = [];
  if (editing) trail.push({ text: 'Rules', to: () => void go('rules') }, { text: editing.draft.name || (editing.index < 0 ? 'New rule' : 'Edit rule') });
  else if (tab === 'trackers' && trackerId) trail.push({ text: label, to: () => void openTracker(null) }, { text: trackers.find((t) => t.id === trackerId)?.name ?? S.trackers.find((t) => t.id === trackerId)?.name ?? 'Tracker' });
  else trail.push({ text: label });
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {trail.map((c, i) => (
        <span key={i} className="crumb">
          {i > 0 && <span className="sep" aria-hidden="true">/</span>}
          {c.to ? <button onClick={c.to}>{c.text}</button> : <span aria-current="page">{c.text}</span>}
        </span>
      ))}
    </nav>
  );
}

function Page() {
  const { tab, editing, trackerId } = useApp();
  if (editing) return <RuleEditor />;
  switch (tab) {
    case 'overview': return <Overview />;
    case 'notifications': return <History />;
    case 'rules': return <Rules />;
    case 'trackers': return trackerId ? <TrackerDetail id={trackerId} /> : <Trackers />;
    case 'delivery': return <Delivery />;
    case 'settings': return <Settings />;
    case 'help': return <Help />;
    default: return <Advanced />;
  }
}

export function Shell() {
  const { S, tab, go, trackerId, tracker, busy, control, editing, pendingKeys, guard, editorDirty, savePending, saveRule } = useApp();
  const { dark, toggle } = useTheme();
  const up = S.status?.running;
  // Red when nothing runs or it has a problem, yellow while starting or waiting for you, green when connected.
  const starting = busy === 'starting' || busy === 'restarting' || tracker.key === 'starting';
  const tone = tracker.key === 'listening' ? 'ok' : tracker.spin || tracker.key === 'qr' ? 'warn' : 'bad';

  // The test-profile strip takes a fixed height out of the layout instead of pushing it down.
  useEffect(() => {
    document.documentElement.style.setProperty('--banner', S.profile ? '30px' : '0px');
  }, [S.profile]);

  // Ctrl+S saves whatever is being edited.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key === 's')) return;
      e.preventDefault();
      if (editing) { if (!validity(editing.draft) && editorDirty) void guard(saveRule)(); } else if (pendingKeys.length) void guard(savePending)();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  return (
    <>
      {S.profile && <div className="profile-banner"><span>Test profile <b>{S.profile}</b> · separate from your installed whatsgrep</span></div>}
      <div className="app">
        <aside className="sidebar">
          <div className="brand"><span className="mark"><Icon name="mark" size={18} /></span><span>whatsgrep</span></div>
          <nav className="nav" aria-label="Sections">
            {TABS.map((t) => {
              const keys = TAB_KEYS[t.id];
              const dot = keys && pendingKeys.some((k) => keys.includes(k));
              const count = t.id === 'rules' ? S.rules.length : t.id === 'trackers' ? S.trackers.length : null;
              return (
                <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => void go(t.id)}>
                  <Icon name={t.icon} /><span className="label">{t.label}</span>
                  {count !== null && <span className="count">{count}</span>}
                  {dot && <span className="dot" title="Unsaved changes" />}
                </button>
              );
            })}
          </nav>
          <div className="grow" />
          <div className="sidefoot">
            <span>{(S.platform === 'win32' ? 'Windows' : S.platform === 'darwin' ? 'macOS' : 'Linux') + (S.version ? ' · v' + S.version : '')}</span><span className="spacer" />
            <button className="btn ghost icon" title="Switch light / dark" aria-label="Switch light or dark theme" onClick={toggle}><Icon name={dark ? 'sun' : 'moon'} /></button>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="titles"><Crumbs /></div>
            <div className="tools">
              <Bell />
              <span className="tools">
                <span className={'tstatus ' + tone} title={tracker.label}>{tracker.spin ? <Spinner /> : <span className="d" />}<span>{tracker.label}</span></span>
                {busy === 'stopping' ? <IconBtn icon="stop" label="Stopping" cls="" busy />
                  : starting ? <IconBtn icon="stop" label="Stop" cls="primary" onClick={guard(() => control('stop'))} />
                  : !up ? <IconBtn icon="play" label="Start" cls="primary" disabled={!S.configExists} onClick={guard(() => control('start'))} />
                  : <><IconBtn icon="refresh" label="Restart" cls="" onClick={guard(() => control('restart'))} /><IconBtn icon="stop" label="Stop" cls="" onClick={guard(() => control('stop'))} /></>}
              </span>
            </div>
          </header>
          <div className="content"><Boundary key={tab + (trackerId ?? '') + (editing ? 'e' : '')}><Page /></Boundary></div>
          <SaveBar />
        </div>
      </div>
      <Toasts />
      <ConfirmHost />
    </>
  );
}
