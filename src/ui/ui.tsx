import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export const Spinner = () => <span className="spin" aria-hidden="true" />;

// A button that is just an icon; the label is its tooltip and its accessible name.
export function IconBtn({ icon, label, onClick, cls = 'ghost', disabled, busy, size = 16 }: { icon: IconName; label: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; cls?: string; disabled?: boolean; busy?: boolean; size?: number }) {
  return <button className={'btn icon ' + cls} title={label} aria-label={label} disabled={disabled || busy} onClick={onClick}>{busy ? <Spinner /> : <Icon name={icon} size={size} />}</button>;
}

export function Switch({ checked, onChange, label, locked }: { checked: boolean; onChange: (on: boolean) => void; label: string; locked?: boolean }) {
  return (
    <label className={'switch' + (locked ? ' locked' : '')} title={locked ? 'At least one notification type must stay on' : ''}>
      <input type="checkbox" checked={checked} disabled={locked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Pill({ cls = '', spin, children }: { cls?: string; spin?: boolean; children: ReactNode }) {
  // Working on it shows just a spinner; the words are the tooltip.
  return <span className={'pill ' + cls + (spin ? ' busy' : '')} title={spin && typeof children === 'string' ? children : undefined}>{spin ? <Spinner /> : <span className="d" />}{!spin && children}</span>;
}

export const Badge = ({ cls = '', title, children }: { cls?: string; title?: string; children: ReactNode }) => <span className={'badge ' + cls} title={title}>{children}</span>;

export function Card({ children, className = '', off }: { children: ReactNode; className?: string; off?: boolean }) {
  return <div className={'card ' + className + (off ? ' off' : '')}>{children}</div>;
}
export const CardHead = ({ title, desc, style, action }: { title: string; desc?: string; style?: React.CSSProperties; action?: ReactNode }) => (
  <div className="head" style={style}><div className="headtext"><h2>{title}</h2>{desc && <p className="desc">{desc}</p>}</div>{action}</div>
);

// A small (i) that explains an option on hover or keyboard focus, so the page itself stays quiet.
export const Tip = ({ text }: { text: string }) => (
  <span className="tip" tabIndex={0} role="note" aria-label={text} data-tip={text}><Icon name="info" size={14} /></span>
);

export const Lbl = ({ children, tip }: { children: ReactNode; tip?: string }) => <label className="lbl">{children}{tip && <Tip text={tip} />}</label>;

export function Seg<T extends string>({ value, options, onChange, label, name }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string; name: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <label key={v}><input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} /><span>{l}</span></label>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title?: string; children?: ReactNode }) {
  return <div className="empty">{title && <b>{title}</b>}{children}</div>;
}

// A native <dialog>: focus stays inside it, Escape closes it, and the page behind is inert.
export function Dialog({ children, onClose, className = '' }: { children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} className={className} onClose={onClose}>
      <button className="btn ghost icon dlg-x" title="Close" aria-label="Close" onClick={closeDialog}><Icon name="x" size={16} /></button>
      {children}
    </dialog>
  );
}

export const closeDialog = (e: { currentTarget: HTMLElement }) => e.currentTarget.closest('dialog')?.close();
