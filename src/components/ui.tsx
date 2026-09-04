import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

/* The primitives every screen is built from. They exist so the depth
   treatment — top highlight, contact shadow, press state — is defined once
   instead of re-derived in each feature. */

export function Panel({
  label,
  children,
  className = '',
  bodyClass = '',
}: {
  label?: string;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <div className={`column ${className}`}>
      {label && <div className="label">{label}</div>}
      <div className={`panel ${bodyClass}`} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

export function Row({
  title,
  sub,
  children,
  onClick,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="row-main">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      {children}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="row row-clickable" onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className="row">{inner}</div>;
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="toggle"
      data-on={on}
      onClick={() => onChange(!on)}
    />
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ['--pct' as string]: `${pct}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/**
 * One avatar for the whole app. An uploaded picture wins over the emoji, and
 * both are drawn as a circle — a squircle sitting inside the pill-shaped
 * profile chip read as a rendering bug rather than a style choice.
 */
export function Avatar({
  emoji,
  url,
  color,
  size = 36,
  name,
}: {
  emoji: string;
  url?: string | null;
  color: string;
  size?: number;
  name?: string;
}) {
  return (
    <div
      className="avatar"
      style={{
        ['--av' as string]: color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.52),
      }}
    >
      {url ? (
        <img src={url} alt={name ? `${name}'s profile picture` : ''} loading="lazy" />
      ) : (
        <span style={{ position: 'relative', zIndex: 1 }}>{emoji}</span>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(760px, 100%)' } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Spinner() {
  return <span className="spinner" />;
}
