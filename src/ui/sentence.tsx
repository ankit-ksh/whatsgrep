import type { ReactNode } from 'react';
import { DAYS, FIELDS, fieldIsSet, fieldLabel, ruleTrackers, type Field } from './rules';
import type { Entry, Kind, RuleForm, Section, TrackerDef } from './types';

const VERB: Record<Kind, string> = { exact: 'has the word', equals: 'is exactly', contains: 'contains', re: 'matches', phone: 'is the number' };
// A chat or sender name is always compared whole, so "exact" reads as plain "is".
const verb = (k: Kind, name: boolean) => (name && k === 'exact' ? 'is' : VERB[k]);
const q = (v: string) => `“${v}”`;

// "is “A” or “B” or contains “C”": entries that share a verb are grouped.
function entries(list: Entry[], name: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  list.forEach((e, i) => {
    const v = verb(e.kind, name);
    const same = i > 0 && verb(list[i - 1].kind, name) === v;
    out.push(same ? <span key={i}> or </span> : <span key={i}>{i > 0 ? ' or ' : ''}{v} </span>, <b key={'b' + i}>{e.kind === 'phone' ? e.value : q(e.value)}</b>);
  });
  return out;
}

// Just the values, for "except" and "is not".
const values = (list: Entry[]): ReactNode[] => list.flatMap((e, i) => [i > 0 ? <span key={'s' + i}>, </span> : null, <b key={i}>{q(e.value)}</b>]);

function section(label: string, s: Section, name: boolean): ReactNode {
  const groups = s.all.filter((g) => g.length);
  return (
    <>
      {label}
      {s.any.length > 0 && <> {entries(s.any, name)}</>}
      {groups.map((g, i) => <span key={i}>{s.any.length || i ? ' and also ' : ' '}{entries(g, name)}</span>)}
      {s.exclude.length > 0 && <>{s.any.length || groups.length ? ', except ' : name ? ' is not ' : ' has none of '}{values(s.exclude)}</>}
    </>
  );
}

// One condition as a clause of the sentence, or null when it is not set.
function clause(d: RuleForm, f: Field, hasWA: boolean, hasMail: boolean, first: boolean): ReactNode {
  const e = d.email;
  const label = first ? fieldLabel(f, hasWA, hasMail) : fieldLabel(f, hasWA, hasMail).replace(/^./, (c) => c.toLowerCase());
  switch (f) {
    case 'from': return section(label, d.from, true);
    case 'message': return section(label, d.message, false);
    case 'subject': return section(label, e.subject, false);
    case 'body': return section(label, e.body, false);
    case 'to': return section(label, e.to, true);
    case 'attachment': return <>it has {e.attachment === 'none' ? 'no attachment' : e.attachment === 'types' ? <>a <b>{e.attachmentTypes.filter(Boolean).join(', ')}</b> file</> : 'an attachment'}</>;
    case 'size': return <>it is {e.larger && <>over <b>{e.larger}</b></>}{e.larger && e.smaller && ' and '}{e.smaller && <>under <b>{e.smaller}</b></>}</>;
    case 'hours': return <>it arrives {e.during.days.length > 0 && <b>{e.during.days.map((x) => DAYS.find((y) => y[0] === x)?.[1] ?? x).join(', ')} </b>}{e.during.from && e.during.to && <b>{e.during.from}\u2013{e.during.to}</b>}</>;
    case 'notBulk': return <>it is not a newsletter or auto-reply</>;
    case 'verified': return <>the sender is verified</>;
    case 'important': return <>it is marked important</>;
  }
}

// The whole rule as a sentence: where it listens, then every condition joined with "and".
export function Sentence({ d, trackers, on = true }: { d: RuleForm; trackers: TrackerDef[]; on?: boolean }) {
  const mine = ruleTrackers(d, trackers);
  const hasWA = mine.some((t) => t.type === 'whatsapp') || !mine.length;
  const hasMail = mine.some((t) => t.type === 'email');
  const set = FIELDS.filter((f) => fieldIsSet(d, f));
  const where = d.on.mode === 'all' ? 'every tracker' : mine.map((t) => t.name).join(', ') || 'nothing yet';
  return (
    <p className="sentence">
      {on && <>On <b>{where}</b>{set.length > 0 && ' · '}</>}
      {set.map((f, i) => <span key={f} className={i === 0 ? 'first' : undefined}>{i > 0 && <span className="and"> and </span>}{clause(d, f, hasWA, hasMail, i === 0)}</span>)}
    </p>
  );
}
