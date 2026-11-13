import { useState } from 'react';
import type { Entry, Kind } from './types';

const TAG: Record<Kind, string> = { contains: 'contains', re: 'pattern', phone: 'number', exact: '', equals: 'exactly' };

const CHAT_KINDS: [Kind, string][] = [['exact', 'Is exactly'], ['contains', 'Contains'], ['re', 'Matches pattern'], ['phone', 'Phone number']];
const SENDER_KINDS: [Kind, string][] = [['exact', 'Is exactly'], ['contains', 'Contains'], ['re', 'Matches pattern']];
const WORD_KINDS: [Kind, string][] = [['exact', 'Has the word'], ['contains', 'Contains'], ['equals', 'Is exactly'], ['re', 'Matches pattern']];
const SUBJECT_KINDS: [Kind, string][] = [['equals', 'Is exactly'], ['contains', 'Contains'], ['exact', 'Has the word'], ['re', 'Matches pattern']];
export const KINDS = { chat: CHAT_KINDS, sender: SENDER_KINDS, word: WORD_KINDS, subject: SUBJECT_KINDS };

// A box of removable chips with a "how to match" choice. Enter or a comma adds an entry.
export function ChipInput({ list, onChange, label, kinds }: { list: Entry[]; onChange: (next: Entry[]) => void; label: string; kinds: [Kind, string][] }) {
  const [kind, setKind] = useState<Kind>(kinds[0][0]);
  const [text, setText] = useState('');
  // A whole subject or a pattern may itself contain commas, so only Enter ends it.
  const literal = kind === 're' || kind === 'equals';

  function commit(raw = text) {
    if (!raw.trim()) return;
    const parts = literal ? [raw] : raw.split(',');
    const next = [...list];
    for (const p of parts.map((x) => x.trim()).filter(Boolean)) if (!next.some((e) => e.kind === kind && e.value === p)) next.push({ kind, value: p });
    setText('');
    if (next.length !== list.length) onChange(next);
  }

  return (
    <div className="chipinput">
      <div className="chipbox" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
        {list.map((e, i) => (
          <span key={e.kind + e.value} className={'chip k-' + e.kind}>
            {TAG[e.kind] && <em>{TAG[e.kind]}</em>}<span className="v">{e.value}</span>
            <button type="button" aria-label={'Remove ' + e.value} onClick={(ev) => { ev.stopPropagation(); onChange(list.filter((_, j) => j !== i)); }}>×</button>
          </span>
        ))}
        <input
          type="text" aria-label={label} autoComplete="off" spellCheck={false} value={text}
          onChange={(e) => { if (!literal && e.target.value.includes(',')) commit(e.target.value); else setText(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Backspace' && !text && list.length) onChange(list.slice(0, -1));
          }}
          onBlur={() => commit()}
        />
      </div>
      <select className="kindsel" aria-label="How to match" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        {kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
