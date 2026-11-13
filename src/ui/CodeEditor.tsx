import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

// Colours come from the app's tokens, so both themes work and the accent stays in one place.
const colours = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--accent)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--warn)' },
  { tag: t.comment, color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [t.separator, t.punctuation, t.squareBracket, t.brace], color: 'var(--muted)' },
  { tag: [t.meta, t.labelName, t.typeName], color: 'var(--info)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line-strong)', borderRadius: '12px', fontSize: '13px' },
  '&.cm-focused': { outline: '2px solid color-mix(in srgb, var(--accent) 45%, transparent)', borderColor: 'var(--accent)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.6', minHeight: '320px', maxHeight: '60vh', borderRadius: '12px' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--faint)', border: 'none', paddingLeft: '6px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
});

// A small YAML editor: colours, line numbers, undo, tab to indent.
export function CodeEditor({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), indentOnInput(), bracketMatching(), highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          yaml(), syntaxHighlighting(colours), theme,
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          EditorView.updateListener.of((u) => { if (u.docChanged) change.current(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The text can also change from outside (loaded, or reloaded from disk).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="codeedit" />;
}
