import React, { useState } from 'react';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function Btn({ children, onClick, kind = 'primary', disabled, className, small }) {
  const [busy, setBusy] = useState(false);
  const styles = {
    primary: 'bg-pink text-ink',
    mint: 'bg-mint text-ink',
    ghost: 'border border-line text-ivory',
    danger: 'border border-pink text-pink',
  }[kind];
  return (
    <button
      disabled={disabled || busy}
      onClick={async (e) => {
        setBusy(true);
        try {
          await onClick?.(e);
        } finally {
          setBusy(false);
        }
      }}
      className={cx(
        'rounded-xl font-display font-extrabold transition active:scale-[.98] disabled:opacity-40',
        small ? 'px-3 py-1.5 text-xs' : 'px-4 py-3 text-sm',
        styles,
        className
      )}
    >
      {children}
    </button>
  );
}

export const Card = ({ children, className }) => (
  <div className={cx('rounded-2xl border border-line bg-surface p-4', className)}>{children}</div>
);

export const Label = ({ children }) => (
  <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-dim">{children}</div>
);

export const Chip = ({ children, tone = 'dim' }) => (
  <span
    className={cx(
      'rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold',
      tone === 'mint' && 'bg-mint/15 text-mint',
      tone === 'pink' && 'bg-pink/15 text-pink',
      tone === 'loss' && 'bg-loss/15 text-loss',
      tone === 'amber' && 'bg-amber/15 text-amber',
      tone === 'dim' && 'bg-line text-muted'
    )}
  >
    {children}
  </span>
);

export const Input = (props) => (
  <input
    {...props}
    className={cx('w-full rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-ivory outline-none focus:border-pink', props.className)}
  />
);

export const Select = ({ children, ...props }) => (
  <select
    {...props}
    className={cx('w-full rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-ivory outline-none focus:border-pink', props.className)}
  >
    {children}
  </select>
);

export function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <button onClick={onClose} className="text-dim">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Pick a finishing order: one dropdown per place, picking a player already used swaps them.
export function OrderPicker({ ids, names, value, onChange }) {
  const labels = ['1st', '2nd', '3rd', '4th'];
  const set = (i, id) => {
    const next = value.slice();
    const j = next.indexOf(id);
    if (j >= 0 && id) next[j] = next[i];
    next[i] = id;
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {ids.map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-9 font-mono text-xs text-muted">{labels[i]}</span>
          <Select value={value[i] || ''} onChange={(e) => set(i, e.target.value)}>
            <option value="">Choose…</option>
            {ids.map((id) => (
              <option key={id} value={id}>{names[id]}</option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

export const orderComplete = (ids, v) => v.length === ids.length && ids.every((id) => v.includes(id));

export const fmtClock = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
