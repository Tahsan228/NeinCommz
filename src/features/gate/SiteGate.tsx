import { useEffect, useRef, useState } from 'react';
import { SITE_PASSWORD } from '../../lib/supabase';
import { Icon } from '../../components/Icon';

/**
 * The front door. This is a curtain, not a lock: the comparison happens in the
 * browser and anyone reading the page source can walk past it. The real lock is
 * the profile password one screen later, which is a genuine account behind
 * row-level security. This exists to keep the site from being casually
 * stumbled into, and that is all it claims to do.
 *
 * Nothing is remembered. Passing the gate lives in React state alone, so every
 * fresh load — a reload, a new tab, coming back tomorrow — asks for the word
 * again. Being signed in does not skip it either; the profile session survives
 * a reload, the gate deliberately does not.
 */
export function SiteGate({ onPass }: { onPass: () => void }) {
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim().toLowerCase() === SITE_PASSWORD.toLowerCase()) {
      onPass();
      return;
    }
    setWrong(true);
    setValue('');
    window.setTimeout(() => setWrong(false), 400);
  };

  return (
    <div className="centered">
      <div className={`gate ${wrong ? 'shake' : ''}`}>
        <div className="gate-mark">
          <Icon name="snowflake" size={32} strokeWidth={1.7} />
        </div>
        <h1>NeinCommz</h1>
        <p>Say the word.</p>
        <form onSubmit={submit}>
          <input
            ref={ref}
            className="input"
            type="password"
            autoComplete="off"
            placeholder="••••"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Site password"
          />
          <button className="btn btn-accent" type="submit" disabled={!value.trim()}>
            Enter
          </button>
        </form>
        <p className="err">{wrong ? 'Not it.' : ''}</p>
      </div>
    </div>
  );
}
