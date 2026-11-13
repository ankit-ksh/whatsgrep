import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { ChipInput, KINDS } from '../chips';
import { ChatPicker } from '../dialogs/ChatPicker';
import { Icon, type IconName } from '../icons';
import { DAYS, EMAIL_ONLY, FIELDS, PRIORITIES, clearField, fieldIsSet, fieldLabel, fieldTip, ruleTrackers, type Field } from '../rules';
import { Sentence } from '../sentence';
import { useApp } from '../store';
import type { Entry, Kind, RuleForm, Section, TrackerDef } from '../types';
import { Card, IconBtn, Lbl, Seg, Tip } from '../ui';
import { clone, errorText } from '../util';

type Edit = (fn: (d: RuleForm) => void) => void;

const Step = ({ n, title }: { n: number; title: string }) => (
  <div className="head stephead"><span className="stepnum">{n}</span><div><h2>{title}</h2></div></div>
);

const ICON: Record<Field, IconName> = {
  from: 'chat', message: 'search', subject: 'list', body: 'rules', to: 'send', attachment: 'clip', size: 'download', hours: 'clock', notBulk: 'filter', verified: 'check', important: 'alert',
};

// The words, senders or chats of one condition: the ones to match, then optional "also" and "except" blocks.
function SectionFields({ sec, set, kinds, label, allowAlso, pick }: {
  sec: Section; set: (fn: (s: Section) => void) => void; kinds: [Kind, string][]; label: string; allowAlso?: boolean;
  pick?: (target: 'any' | 'exclude') => ReactNode;
}) {
  const [exOpen, setExOpen] = useState(false);
  const showEx = sec.exclude.length > 0 || exOpen;
  return (
    <>
      <div>
        <ChipInput list={sec.any} kinds={kinds} label={label} onChange={(next) => set((s) => { s.any = next; })} />
        {pick && <div className="row-actions" style={{ marginTop: 8 }}>{pick('any')}</div>}
      </div>
      {sec.all.map((g, gi) => (
        <div className="sub-block" key={gi}>
          <div className="top"><b>And also one of</b><IconBtn icon="x" label="Remove" onClick={() => set((s) => { s.all.splice(gi, 1); })} /></div>
          <ChipInput list={g} kinds={kinds} label="Any one of these is enough" onChange={(next) => set((s) => { s.all[gi] = next; })} />
        </div>
      ))}
      {showEx && (
        <div className="sub-block ignore">
          <div className="top"><b>Except</b><IconBtn icon="x" label="Remove" onClick={() => { setExOpen(false); set((s) => { s.exclude = []; }); }} /></div>
          <ChipInput list={sec.exclude} kinds={kinds} label={label + ' to leave out'} onChange={(next) => set((s) => { s.exclude = next; })} />
          {pick && <div className="row-actions">{pick('exclude')}</div>}
        </div>
      )}
      <div className="addlinks">
        {allowAlso && <button className="btn sm" onClick={() => set((s) => { s.all.push([]); })}><Icon name="plus" size={14} />Also require another</button>}
        {!showEx && <button className="btn sm" onClick={() => setExOpen(true)}><Icon name="plus" size={14} />Except</button>}
      </div>
    </>
  );
}

// One condition: what it is about, and the controls to set it.
function Cond({ icon, label, tip, onRemove, children }: { icon: IconName; label: string; tip?: string; onRemove: () => void; children?: ReactNode }) {
  return (
    <div className="cond">
      <div className="condhead">
        <span className="lead"><Icon name={icon} size={18} /></span>
        <b>{label}{tip && <Tip text={tip} />}</b>
        <IconBtn icon="x" label={'Remove ' + label} onClick={onRemove} />
      </div>
      {children && <div className="condbody">{children}</div>}
    </div>
  );
}

function AddMenu({ options, onPick, primary, grouped }: { options: { field: Field; label: string; icon: IconName; email?: boolean }[]; onPick: (f: Field) => void; primary: boolean; grouped: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!options.length) return null;
  const mixed = grouped && options.some((o) => o.email) && options.some((o) => !o.email);
  return (
    <div className="menuwrap" ref={ref}>
      <button className={'btn' + (primary ? ' primary' : '')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="plus" size={16} />Add condition</button>
      {open && (
        <div className="menu" role="menu">
          {options.map((o, i) => (
            <div key={o.field}>
              {mixed && o.email && !options[i - 1]?.email && <div className="menuhead">Email only</div>}
              <button role="menuitem" className="menuitem" onClick={() => { setOpen(false); onPick(o.field); }}><span className="lead"><Icon name={o.icon} size={16} /></span>{o.label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Check({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <li><span className={ok ? 'ok' : 'no'}><Icon name={ok ? 'check' : 'x'} size={16} /></span>{ok ? yes : no}</li>;
}

interface PreviewMail { from: string; address: string; subject: string; date: number; attachments: string[]; matched: boolean }
interface TestResult { usable: boolean; chat: boolean; message: boolean; subject: boolean; body: boolean; matched: boolean }

export function RuleEditor() {
  const { S, editing, setDraft, trackers, toast } = useApp();
  const E = editing!;
  const d = E.draft;
  const edit: Edit = (fn) => { const next = clone(E.draft); fn(next); setDraft(next); };

  const mine = ruleTrackers(d, trackers);
  const hasMail = mine.some((t) => t.type === 'email');
  const hasWA = mine.some((t) => t.type === 'whatsapp') || !hasMail;
  const showOn = trackers.length > 1 || trackers.some((t) => t.type === 'email');
  const waTrackers = mine.filter((t) => t.type === 'whatsapp');
  const em = d.email;

  const [added, setAdded] = useState<Set<Field>>(new Set());
  const [picker, setPicker] = useState<{ tracker: TrackerDef; target: 'any' | 'exclude' } | null>(null);
  const [test, setTest] = useState({ chat: '', text: '', subject: '', body: '' });
  const [verdict, setVerdict] = useState<ReactNode>(null);

  const shown = (f: Field) => fieldIsSet(d, f) || added.has(f);
  const addField = (f: Field) => {
    setAdded((a) => new Set(a).add(f));
    edit((x) => {
      if (f === 'attachment') x.email.attachment = 'any';
      else if (f === 'hours') x.email.during.enabled = true;
      else if (f === 'notBulk' || f === 'verified' || f === 'important') x.email[f] = true;
    });
  };
  const removeField = (f: Field) => {
    setAdded((a) => { const n = new Set(a); n.delete(f); return n; });
    edit((x) => clearField(x, f));
  };
  const options = FIELDS.filter((f) => !shown(f) && (hasMail || !EMAIL_ONLY.includes(f))).map((f) => ({ field: f, label: fieldLabel(f, hasWA, hasMail), icon: f === 'from' && !hasWA ? 'mail' as IconName : ICON[f], email: EMAIL_ONLY.includes(f) }));
  const anyShown = FIELDS.some(shown);

  // Which trackers: every one, or chosen ones. A rule written before trackers existed means WhatsApp only.
  const selectedNames = d.on.mode === 'legacy' ? trackers.filter((t) => t.type === 'whatsapp').map((t) => t.name) : d.on.names;
  const setOnMode = (m: 'all' | 'names') => edit((x) => { x.on = m === 'all' ? { mode: 'all', names: [] } : { mode: 'names', names: selectedNames.length ? selectedNames : trackers.map((t) => t.name) }; });
  const toggleTracker = (name: string, on: boolean) => edit((x) => { x.on = { mode: 'names', names: on ? [...new Set([...selectedNames, name])] : selectedNames.filter((n) => n !== name) }; });

  // "Try it": would this rule fire for a sample? Email-only rules are tried with a subject and a body.
  const mailTest = hasMail && !hasWA;
  useEffect(() => {
    const id = setTimeout(async () => {
      const blank = mailTest ? !test.chat.trim() && !test.subject.trim() && !test.body.trim() : !test.chat.trim() && !test.text.trim();
      if (blank) {
        setVerdict(<div className="verdict"><span className="big"><Icon name="search" size={18} /></span><div><b>Try a message</b></div></div>);
        return;
      }
      try {
        const r = await api<TestResult>('POST', '/api/rule/test', mailTest ? { rule: d, chat: test.chat, subject: test.subject, body: test.body } : { rule: d, chat: test.chat, text: test.text });
        if (!r.usable) { setVerdict(<div className="verdict"><span className="big"><Icon name="alert" size={18} /></span><div><b>Not ready yet</b></div></div>); return; }
        setVerdict(
          <>
            <div className={'verdict ' + (r.matched ? 'yes' : 'no')}><span className="big"><Icon name={r.matched ? 'check' : 'x'} size={18} /></span><div><b>{r.matched ? 'Would notify you' : 'Would not notify'}</b></div></div>
            <ul className="checks">
              {fieldIsSet(d, 'from') && <Check ok={r.chat} yes="The chat or sender matches" no="The chat or sender does not match" />}
              {fieldIsSet(d, 'message') && <Check ok={r.message} yes="The text matches" no="The text does not match" />}
              {fieldIsSet(d, 'subject') && <Check ok={r.subject} yes="The subject matches" no="The subject does not match" />}
              {fieldIsSet(d, 'body') && <Check ok={r.body} yes="The body matches" no="The body does not match" />}
            </ul>
          </>,
        );
      } catch (e) { setVerdict(<div className="hint">{errorText(e)}</div>); }
    }, 220);
    return () => clearTimeout(id);
  }, [d, test, mailTest]);

  const pickBtns = (target: 'any' | 'exclude') => waTrackers.map((t) => <IconBtn key={t.id} icon="search" label={'Pick from ' + (waTrackers.length > 1 ? t.name : 'my chats')} cls="" onClick={() => setPicker({ tracker: t, target })} />);
  const fromKinds = hasWA ? KINDS.chat : KINDS.sender;
  const sec = (get: (x: RuleForm) => Section) => (fn: (s: Section) => void) => edit((x) => fn(get(x)));

  const cond = (f: Field): ReactNode => {
    const label = fieldLabel(f, hasWA, hasMail);
    const tip = fieldTip[f];
    const remove = () => removeField(f);
    switch (f) {
      case 'from': return <Cond key={f} icon={hasMail && !hasWA ? 'mail' : 'chat'} label={label} onRemove={remove}><SectionFields sec={d.from} set={sec((x) => x.from)} kinds={fromKinds} label={label} pick={waTrackers.length ? pickBtns : undefined} /></Cond>;
      case 'message': return <Cond key={f} icon={ICON[f]} label={label} tip={tip} onRemove={remove}><SectionFields sec={d.message} set={sec((x) => x.message)} kinds={KINDS.word} label={label} allowAlso /></Cond>;
      case 'subject': return <Cond key={f} icon={ICON[f]} label={label} onRemove={remove}><SectionFields sec={em.subject} set={sec((x) => x.email.subject)} kinds={KINDS.subject} label={label} /></Cond>;
      case 'body': return <Cond key={f} icon={ICON[f]} label={label} onRemove={remove}><SectionFields sec={em.body} set={sec((x) => x.email.body)} kinds={KINDS.word} label={label} /></Cond>;
      case 'to': return <Cond key={f} icon={ICON[f]} label={label} tip={tip} onRemove={remove}><SectionFields sec={em.to} set={sec((x) => x.email.to)} kinds={KINDS.sender} label={label} /></Cond>;
      case 'attachment': return (
        <Cond key={f} icon={ICON[f]} label={label} onRemove={remove}>
          <select aria-label="Attachment" value={em.attachment || 'any'} onChange={(e) => edit((x) => { x.email.attachment = e.target.value as typeof em.attachment; })}>
            <option value="any">Has an attachment</option><option value="none">Has no attachment</option><option value="types">Has a file of these types</option>
          </select>
          {em.attachment === 'types' && <input type="text" aria-label="File types" value={em.attachmentTypes.join(', ')} onChange={(e) => edit((x) => { x.email.attachmentTypes = e.target.value.split(',').map((v) => v.trimStart()); })} />}
          {em.attachment === 'types' && <div className="hint">pdf, xlsx, or contains:invoice</div>}
        </Cond>
      );
      case 'size': return (
        <Cond key={f} icon={ICON[f]} label={label} onRemove={remove}>
          <div className="two">
            <div><Lbl>Larger than</Lbl><input type="text" aria-label="Larger than" value={em.larger} onChange={(e) => edit((x) => { x.email.larger = e.target.value; })} /></div>
            <div><Lbl>Smaller than</Lbl><input type="text" aria-label="Smaller than" value={em.smaller} onChange={(e) => edit((x) => { x.email.smaller = e.target.value; })} /></div>
          </div>
          <div className="hint">500KB, 2MB, 1GB</div>
        </Cond>
      );
      case 'hours': return (
        <Cond key={f} icon={ICON[f]} label={label} tip={tip} onRemove={remove}>
          <div className="daypick" role="group" aria-label="Days">
            {DAYS.map(([v, l]) => <button key={v} type="button" className={'btn sm' + (em.during.days.includes(v) ? ' primary' : '')} aria-pressed={em.during.days.includes(v)} onClick={() => edit((x) => { const set = new Set(x.email.during.days); if (set.has(v)) set.delete(v); else set.add(v); x.email.during.days = DAYS.map(([k]) => k).filter((k) => set.has(k)); })}>{l}</button>)}
            <span className="hint" style={{ margin: 0 }}>{em.during.days.length ? '' : 'Every day'}</span>
          </div>
          <div className="row-actions"><Lbl>From</Lbl><input type="time" aria-label="From" value={em.during.from} onChange={(e) => edit((x) => { x.email.during.from = e.target.value; })} /><Lbl>to</Lbl><input type="time" aria-label="To" value={em.during.to} onChange={(e) => edit((x) => { x.email.during.to = e.target.value; })} /></div>
        </Cond>
      );
      case 'notBulk': case 'verified': case 'important': return <Cond key={f} icon={ICON[f]} label={label} tip={tip} onRemove={remove} />;
    }
  };

  const n = showOn ? 3 : 2;
  return (
    <>
      <div className="editor">
        <div>
          <Card>
            <Step n={1} title="Name and loudness" />
            <div className="body">
              <div className="namefield"><Lbl>Rule name</Lbl><input type="text" aria-label="Rule name" value={d.name} onChange={(e) => edit((x) => { x.name = e.target.value; })} /></div>
              <div className="prio"><Lbl tip="How strongly an alert buzzes on your devices. Silent makes no sound; Urgent is the loudest.">Alert priority</Lbl><Seg name="prio" label="Alert priority" value={d.priority} options={PRIORITIES} onChange={(v) => edit((x) => { x.priority = v; })} /></div>
            </div>
          </Card>

          {showOn && (
            <Card>
              <Step n={2} title="Listen on" />
              <div className="body">
                <Seg name="on" label="Which trackers" value={d.on.mode === 'all' ? 'all' : 'names'} options={[['all', 'Every tracker'], ['names', 'Only these trackers']]} onChange={setOnMode} />
                {d.on.mode !== 'all' && (
                  <div className="trackerpick">
                    {trackers.map((t) => (
                      <label key={t.id} className="checkrow"><input type="checkbox" checked={selectedNames.some((x) => x.toLowerCase() === t.name.toLowerCase())} onChange={(e) => toggleTracker(t.name, e.target.checked)} /><Icon name={t.type === 'email' ? 'mail' : 'chat'} size={15} /><span>{t.name}</span>{!t.enabled && <span className="hint" style={{ margin: 0 }}>off</span>}</label>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card className="pop">
            <Step n={n} title="Conditions" />
            <div className="body">
              {anyShown ? FIELDS.filter(shown).map(cond) : <div className="condempty"><Icon name="filter" size={18} />No conditions yet</div>}
              <div><AddMenu options={options} onPick={addField} primary={!anyShown} grouped={hasWA && hasMail} /></div>
            </div>
          </Card>
        </div>

        <div className="side">
          <Card>
            <div className="head"><h2>Summary</h2></div>
            <div className="body">
              <Sentence d={d} trackers={trackers} />
              <p className="hint">Anything you do not add is ignored.</p>
            </div>
          </Card>
          <Card>
            <div className="head"><h2>Try it</h2></div>
            <div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><Lbl>{mailTest ? 'Sender' : 'Chat or sender'}</Lbl><input type="text" aria-label="Chat or sender" value={test.chat} onChange={(e) => setTest((t) => ({ ...t, chat: e.target.value }))} /></div>
              {mailTest ? (
                <>
                  <div><Lbl>Subject</Lbl><input type="text" aria-label="Subject" value={test.subject} onChange={(e) => setTest((t) => ({ ...t, subject: e.target.value }))} /></div>
                  <div><Lbl>Body</Lbl><input type="text" aria-label="Body" value={test.body} onChange={(e) => setTest((t) => ({ ...t, body: e.target.value }))} /></div>
                </>
              ) : (
                <div><Lbl>Message</Lbl><input type="text" aria-label="Message" value={test.text} onChange={(e) => setTest((t) => ({ ...t, text: e.target.value }))} /></div>
              )}
              {verdict}
            </div>
          </Card>
          {hasMail && <RecentMail d={d} trackers={mine.filter((t) => t.type === 'email')} S={S} toast={toast} />}
        </div>
      </div>
      {picker && (
        <ChatPicker tracker={picker.tracker} list={picker.target === 'exclude' ? d.from.exclude : d.from.any} onClose={() => setPicker(null)}
          onChange={(next: Entry[]) => edit((x) => { if (picker.target === 'exclude') x.from.exclude = next; else x.from.any = next; })} />
      )}
    </>
  );
}

// Which of the latest mails would this rule have caught? Reads the mailbox, changes nothing.
function RecentMail({ d, trackers, S, toast }: { d: RuleForm; trackers: TrackerDef[]; S: ReturnType<typeof useApp>['S']; toast: ReturnType<typeof useApp>['toast'] }) {
  const usable = trackers.filter((t) => S.trackers.some((x) => x.id === t.id && x.hasPassword));
  const [id, setId] = useState(usable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [mails, setMails] = useState<PreviewMail[] | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ usable: boolean; mails: PreviewMail[] }>('POST', '/api/email/preview', { id, rule: d, limit: 50 });
      if (!r.usable) { toast('Add a word, a sender or an email condition first.', { err: true }); setMails(null); } else setMails(r.mails);
    } catch (e) { toast(errorText(e), { err: true }); } finally { setBusy(false); }
  };
  const hits = mails?.filter((m) => m.matched).length ?? 0;
  return (
    <Card>
      <div className="head"><h2>Check recent mail</h2></div>
      <div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!usable.length ? <div className="hint">Save the email account first.</div> : (
          <>
            {usable.length > 1 && <select aria-label="Mailbox" value={id} onChange={(e) => setId(e.target.value)}>{usable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
            <IconBtn icon="filter" label="Check last 50 emails" cls="" busy={busy} onClick={() => void run()} />
          </>
        )}
        {mails && (
          <>
            <div className={'verdict ' + (hits ? 'yes' : '')}><span className="big"><Icon name={hits ? 'check' : 'search'} size={18} /></span><div><b>{hits} of {mails.length} would alert</b></div></div>
            <ul className="mailprev">
              {mails.map((m, i) => (
                <li key={i} className={m.matched ? 'hit' : ''}>
                  <b>{m.from || m.address}</b>
                  <span>{m.subject || '(no subject)'}</span>
                  {m.attachments.length > 0 && <small><Icon name="clip" size={12} /> {m.attachments.join(', ')}</small>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
