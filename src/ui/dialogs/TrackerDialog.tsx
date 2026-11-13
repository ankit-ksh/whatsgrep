import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { TrackerDef } from '../types';
import { Dialog, IconBtn, Lbl } from '../ui';
import { errorText, slug } from '../util';

const guessProvider = (address: string) => {
  const d = address.split('@')[1]?.toLowerCase() ?? '';
  if (/^(gmail|googlemail)\.com$/.test(d)) return 'gmail';
  if (/^(outlook|hotmail|live|msn)\./.test(d)) return 'outlook';
  if (/^(yahoo|ymail|rocketmail)\./.test(d)) return 'yahoo';
  if (/^(icloud|me|mac)\.com$/.test(d)) return 'icloud';
  if (/^fastmail\./.test(d)) return 'fastmail';
  return 'other';
};

interface Props { type: 'whatsapp' | 'email'; initial?: TrackerDef; onSave: (def: TrackerDef, password?: string) => void; onClose: () => void }

// Add or edit one tracker. Nothing is applied until the common Save.
interface FolderInfo { path: string; name: string; special: string | null }
const MAX_FOLDERS = 5; // one connection each; the server refuses a config with more
const SPECIAL: Record<string, string> = { '\\All': 'Everything, one connection', '\\Sent': 'Sent', '\\Drafts': 'Drafts', '\\Junk': 'Spam', '\\Trash': 'Trash', '\\Archive': 'Archive', '\\Flagged': 'Starred' };

export function TrackerDialog({ type, initial, onSave, onClose }: Props) {
  const { S, trackers, toast } = useApp();
  const [name, setName] = useState(initial?.name ?? (type === 'whatsapp' ? '' : ''));
  const [user, setUser] = useState(initial?.user ?? '');
  const [provider, setProvider] = useState(initial?.provider ?? 'other');
  const [touchedProvider, setTouchedProvider] = useState(!!initial);
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(String(initial?.port ?? 993));
  const [folders, setFolders] = useState((initial?.folders ?? ['INBOX']).join(', '));
  const [password, setPassword] = useState('');
  const [test, setTest] = useState<{ busy?: boolean; ok?: boolean; text?: string }>({});
  const [error, setError] = useState('');
  const [found, setFound] = useState<{ busy?: boolean; list?: FolderInfo[]; error?: string }>({});
  const preset = S.providers.find((p) => p.id === provider);
  const saved = initial && S.trackers.some((t) => t.id === initial.id);

  const effectiveHost = provider === 'other' ? host.trim() : (host.trim() && host.trim() !== preset?.host ? host.trim() : preset?.host ?? '');
  const folderList = folders.split(',').map((f) => f.trim()).filter(Boolean);

  function onUser(v: string) {
    setUser(v);
    if (!touchedProvider) setProvider(guessProvider(v));
  }

  async function runTest() {
    if (!password && !(saved && initial?.hasPassword)) { setTest({ ok: false, text: 'Enter the password to test.' }); return; }
    setTest({ busy: true });
    try {
      const r = await api<{ ok: boolean; messages?: number; error?: string }>('POST', '/api/email/test', {
        id: password ? undefined : initial?.id, user: user.trim(), provider, host: effectiveHost, port: Number(port), folder: folderList[0] ?? 'INBOX', password: password || undefined,
      });
      setTest(r.ok ? { ok: true, text: `Connected. ${folderList[0] ?? 'INBOX'} has ${r.messages} messages.` } : { ok: false, text: r.error });
    } catch (e) { setTest({ ok: false, text: errorText(e) }); }
  }

  // Ask the server for the account's folders, so they can be ticked instead of typed.
  async function loadFolders() {
    if (!password && !(saved && initial?.hasPassword)) { setFound({ error: 'Enter the password first.' }); return; }
    setFound({ busy: true });
    try {
      const r = await api<{ ok: boolean; folders?: FolderInfo[]; error?: string }>('POST', '/api/email/folders', {
        id: password ? undefined : initial?.id, user: user.trim(), provider, host: effectiveHost, port: Number(port), password: password || undefined,
      });
      setFound(r.ok ? { list: r.folders } : { error: r.error });
    } catch (e) { setFound({ error: errorText(e) }); }
  }
  const toggleFolder = (path: string, on: boolean) => {
    const next = on ? [...folderList, path] : folderList.filter((f) => f !== path);
    if (next.length > MAX_FOLDERS) return;
    setFolders(next.join(', '));
  };

  function submit() {
    const n = name.trim();
    if (!n) return setError('Give it a name.');
    if (trackers.some((t) => t.id !== initial?.id && t.name.toLowerCase() === n.toLowerCase())) return setError('Another tracker already has that name.');
    if (type === 'whatsapp') return finish({ id: initial?.id ?? uniqueId(n), name: n, type, enabled: initial?.enabled ?? true });
    if (!user.trim()) return setError('Enter the email address.');
    if (!effectiveHost) return setError('Enter the mail server.');
    if (!folderList.length) return setError('Choose at least one folder.');
    if (folderList.length > MAX_FOLDERS) return setError(`At most ${MAX_FOLDERS} folders: each one is a separate connection.`);
    if (!initial && !password) return setError('Enter the password.');
    finish({
      id: initial?.id ?? uniqueId(n), name: n, type, enabled: initial?.enabled ?? true,
      user: user.trim(), provider, host: effectiveHost, port: Number(port) || 993, folders: folderList,
    }, password || undefined);
  }
  const uniqueId = (n: string) => {
    let id = slug(n) || 'tracker', i = 2;
    while (trackers.some((t) => t.id === id)) id = `${slug(n) || 'tracker'}-${i++}`;
    return id;
  };
  const finish = (def: TrackerDef, pw?: string) => { onSave(def, pw); toast(initial ? 'Updated. Press Save changes to apply.' : 'Added. Press Save changes to apply.'); onClose(); };

  return (
    <Dialog onClose={onClose} className="trackerdlg">
      <h3>{initial ? `Edit ${initial.name}` : type === 'whatsapp' ? 'Add a WhatsApp account' : 'Add an email account'}</h3>
      <div className="formgrid">
        <div><Lbl>Name</Lbl><input type="text" aria-label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
        {type === 'email' && (
          <>
            <div><Lbl>Email address</Lbl><input type="text" aria-label="Email address" autoComplete="off" value={user} onChange={(e) => onUser(e.target.value)} /></div>
            <div>
              <Lbl>Provider</Lbl>
              <select aria-label="Provider" value={provider} onChange={(e) => { setProvider(e.target.value); setTouchedProvider(true); }}>
                {S.providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {preset && <div className="hint">{preset.help}</div>}
            </div>
            {provider === 'other' && (
              <div className="two">
                <div><Lbl tip="The IMAP server of your provider. Filled in for the known providers.">Mail server (IMAP)</Lbl><input type="text" aria-label="Mail server" value={host} onChange={(e) => setHost(e.target.value)} /></div>
                <div><Lbl>Port</Lbl><input type="number" aria-label="Port" value={port} onChange={(e) => setPort(e.target.value)} /></div>
              </div>
            )}
            <div>
              <Lbl tip="Use an app password, not your normal one. It is stored in your computer's keychain, never in the config file.">{initial ? 'New password' : 'Password'}</Lbl>
              <input type="password" aria-label="Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <div className="hint">{initial?.hasPassword && !password ? 'Saved. Leave empty to keep it.' : 'Stored in your keychain.'}</div>
            </div>
            <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
              <IconBtn icon="plug" label="Test connection" cls="" busy={test.busy} onClick={() => void runTest()} />
              {test.text && <span className="hint" style={{ margin: 0, color: test.ok ? 'var(--ok)' : 'var(--danger)' }}>{test.text}</span>}
            </div>
            <div>
              <Lbl tip={`Each folder is a separate connection to the mail server, so at most ${MAX_FOLDERS}. For Gmail, All Mail covers every labelled mail in one connection.`}>Folders to watch</Lbl>
              <div className="folderrow">
                <input type="text" aria-label="Folders" value={folders} onChange={(e) => setFolders(e.target.value)} />
                <IconBtn icon="list" label="Load folders from the mail server" cls="" busy={found.busy} onClick={() => void loadFolders()} />
              </div>
              {found.error && <div className="hint" style={{ color: 'var(--danger)' }}>{found.error}</div>}
              {found.list && (
                <div className="folderlist" role="group" aria-label="Folders on the server">
                  {found.list.map((f) => {
                    const on = folderList.includes(f.path);
                    const full = !on && folderList.length >= MAX_FOLDERS;
                    return (
                      <label key={f.path} className={'checkrow' + (full ? ' dim' : '')} title={full ? `At most ${MAX_FOLDERS} folders` : undefined}>
                        <input type="checkbox" checked={on} disabled={full} onChange={(e) => toggleFolder(f.path, e.target.checked)} />
                        <span><b>{f.name}</b>{f.special && SPECIAL[f.special] && <small>{SPECIAL[f.special]}</small>}</span>
                      </label>
                    );
                  })}
                  <div className="hint">{folderList.length} of {MAX_FOLDERS} folders</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {error && <div className="hint" style={{ color: 'var(--danger)', marginTop: 10 }}>{error}</div>}
      <div className="row-actions" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
        <IconBtn icon="check" label={initial ? 'Done' : 'Add'} cls="primary" onClick={submit} />
      </div>
    </Dialog>
  );
}

