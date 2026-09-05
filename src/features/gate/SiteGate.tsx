import { useEffect, useRef, useState } from 'react';
import { SITE_PASSWORD } from '../../lib/supabase';
import { LogoMark } from '../../components/Logo';

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

  const submit = (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.();
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
          <LogoMark size={44} />
        </div>
        <h1>NeinCommz</h1>
        <p>Say the word.</p>
        {/*
          Deliberately not a <form> and deliberately not a password field.

          Browsers offer to save — and worse, to *update* — anything that
          looks like a login, so typing the shared word here kept prompting
          people to overwrite the saved password for their actual profile.
          A one-time-code field in a plain div is the same thing to a person
          and nothing to a password manager.
        */}
        <div className="gate-row">
          <input
            ref={ref}
            className="input"
            type="password"
            name="entry-word"
            autoComplete="one-time-code"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            placeholder="••••"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-label="Entry word"
          />
          <button className="btn btn-accent" onClick={() => submit()} disabled={!value.trim()}>
            Enter
          </button>
        </div>
        <p className="err">{wrong ? 'Not it.' : ''}</p>
      </div>
    </div>
  );
}
