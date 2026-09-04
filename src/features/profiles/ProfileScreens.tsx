import { useEffect, useRef, useState } from 'react';
import { errText, isConfigured, MAX_UPLOAD_BYTES, slugify, supabase } from '../../lib/supabase';
import type { PublicProfile } from '../../lib/types';
import { useSession } from '../../state/session';
import { Field, Modal, Spinner } from '../../components/ui';
import { Icon } from '../../components/Icon';

export const EMOJI_CHOICES = [
  '🙂', '😎', '🦊', '🐸', '👾', '🐙', '🦖', '🐧', '🦈', '🐺',
  '🍕', '🌮', '🔥', '⚡', '🌙', '☄️', '🎧', '🎮', '🏀', '⚽',
  '💀', '👽', '🤖', '🧊', '🌵', '🍄', '🦇', '🐝', '🎯', '🛹',
];

export const COLOR_CHOICES = [
  '#e0574f', '#e8833a', '#e6b422', '#6bbf59', '#3fb6a8',
  '#4a9de0', '#6a6de0', '#9b5de5', '#e05f9b', '#8a8f98',
];

/**
 * Picture, emoji and colour in one control, shared by profile creation and
 * settings. An uploaded photo wins over the emoji, so the emoji grid dims
 * while one is set rather than disappearing — the fallback is still there if
 * you remove the picture.
 */
export function AvatarEditor({
  emoji,
  color,
  url,
  busy,
  onEmoji,
  onColor,
  onFile,
  onRemove,
}: {
  emoji: string;
  color: string;
  url: string | null;
  busy?: boolean;
  onEmoji: (e: string) => void;
  onColor: (c: string) => void;
  onFile: (f: File) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const take = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return setError('That needs to be an image.');
    if (f.size > MAX_UPLOAD_BYTES) return setError('That image is over 8 MB.');
    setError('');
    onFile(f);
  };

  return (
    <>
      <div className="pfp-editor">
        <div className="pfp-preview" style={{ ['--av' as string]: color }}>
          {busy ? (
            <Spinner />
          ) : url ? (
            <img src={url} alt="Your profile picture" />
          ) : (
            <span style={{ position: 'relative', zIndex: 1 }}>{emoji}</span>
          )}
        </div>

        <div className="pfp-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              take(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={15} />
            {url ? 'Change picture' : 'Upload a picture'}
          </button>
          {url && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove}>
              <Icon name="trash" size={15} />
              Remove
            </button>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
            {url ? 'Shown everywhere instead of the emoji.' : 'PNG or JPG, up to 8 MB.'}
          </div>
        </div>
      </div>

      {error && <p className="err" style={{ marginTop: -8 }}>{error}</p>}

      <Field label={url ? 'Fallback emoji' : 'Avatar emoji'}>
        <div className="emoji-grid" style={url ? { opacity: 0.5 } : undefined}>
          {EMOJI_CHOICES.map((e) => (
            <button key={e} type="button" data-sel={e === emoji} onClick={() => onEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Tile colour">
        <div className="swatches">
          {COLOR_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ ['--sw' as string]: c }}
              data-sel={c === color}
              onClick={() => onColor(c)}
              aria-label={`Colour ${c}`}
            />
          ))}
        </div>
      </Field>
    </>
  );
}

/* ======================================================= profile picker == */

export function ProfilePicker({
  onPick,
  onCreate,
}: {
  onPick: (p: PublicProfile) => void;
  onCreate: () => void;
}) {
  const [list, setList] = useState<PublicProfile[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isConfigured) {
      setError(
        'Supabase is not configured yet. Copy .env.example to .env and fill in your project URL and anon key.',
      );
      setList([]);
      return;
    }
    supabase
      .from('profiles_public')
      .select('*')
      .order('display_name')
      .then(({ data, error: e }) => {
        if (e) setError(errText(e));
        setList((data as PublicProfile[]) ?? []);
      });
  }, []);

  if (!list) {
    return (
      <div className="centered">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="centered">
      <div className="picker">
        <h1>Who's here?</h1>
        <div className="tiles">
          {list.map((p) => (
            <button className="tile" key={p.id} onClick={() => onPick(p)}>
              <div className="tile-face" style={{ ['--av' as string]: p.avatar_color }}>
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" loading="lazy" />
                ) : (
                  <span style={{ position: 'relative', zIndex: 1 }}>{p.avatar_emoji}</span>
                )}
              </div>
              <div className="tile-name">{p.display_name}</div>
            </button>
          ))}

          <button className="tile tile-new" onClick={onCreate}>
            <div className="tile-face">
              <Icon name="plus" size={38} strokeWidth={1.6} />
            </div>
            <div className="tile-name">Add profile</div>
          </button>
        </div>
        {error && <p className="err" style={{ marginTop: 24 }}>{error}</p>}
      </div>
    </div>
  );
}

/* ====================================================== password prompt == */

export function PasswordPrompt({
  target,
  onClose,
}: {
  target: PublicProfile;
  onClose: () => void;
}) {
  const { signIn } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(target.slug, password);
      // On success the session listener swaps the whole screen out; no need
      // to close anything here.
    } catch (err) {
      setError(errText(err));
      setPassword('');
      setBusy(false);
    }
  };

  if (forgot) return <ForgotPassword target={target} onClose={() => setForgot(false)} />;

  return (
    <Modal
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="avatar"
            style={{ ['--av' as string]: target.avatar_color, width: 30, height: 30, fontSize: 16 }}
          >
            {target.avatar_url ? (
              <img src={target.avatar_url} alt="" />
            ) : (
              <span style={{ position: 'relative', zIndex: 1 }}>{target.avatar_emoji}</span>
            )}
          </span>
          {target.display_name}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button className="btn btn-accent" onClick={submit} disabled={busy || !password}>
            {busy ? <Spinner /> : 'Unlock'}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Profile password">
          <input
            ref={ref}
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setForgot(true)}
          style={{ paddingLeft: 0 }}
        >
          Forgot password?
        </button>
        <p className="err">{error}</p>
      </form>
    </Modal>
  );
}

/* ====================================================== forgot password == */

function ForgotPassword({ target, onClose }: { target: PublicProfile; onClose: () => void }) {
  const { sendReset } = useSession();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendReset(email);
      setSent(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Reset password"
      onClose={onClose}
      footer={
        sent ? (
          <button className="btn btn-accent" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Back
            </button>
            <button className="btn btn-accent" onClick={submit} disabled={busy || !email.includes('@')}>
              {busy ? <Spinner /> : 'Send reset link'}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <p style={{ lineHeight: 1.6, color: 'var(--ink-dim)', margin: 0 }}>
          If an account uses <b>{email}</b>, a reset link is on its way. Open it in this browser and
          you'll land straight on a screen to pick a new password.
        </p>
      ) : (
        <form onSubmit={submit}>
          {!target.has_recovery && (
            <p
              style={{
                margin: '0 0 14px',
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(240, 180, 41, 0.12)',
                color: '#f0c66a',
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >
              Heads up: <b>{target.display_name}</b> was created without a recovery email, so there
              may be nothing to send to. Whoever set it up can add one from Settings once signed in.
            </p>
          )}
          <Field label="Recovery email">
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <p className="err">{error}</p>
        </form>
      )}
    </Modal>
  );
}

/* ================================================= complete a reset link == */

export function ResetPasswordScreen() {
  const { completeReset } = useSession();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mismatch = confirm.length > 0 && password !== confirm;
  const ok = password.length >= 6 && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await completeReset(password);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <div className="gate" style={{ width: 'min(420px, 100%)' }}>
        <div className="gate-mark">
          <Icon name="key" size={30} strokeWidth={1.7} />
        </div>
        <h1>New password</h1>
        <p>Pick something you'll remember this time.</p>
        <form onSubmit={submit} style={{ display: 'block', textAlign: 'left' }}>
          <Field label="New password">
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm">
            <input
              className="input"
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <button className="btn btn-accent" style={{ width: '100%' }} disabled={!ok || busy}>
            {busy ? <Spinner /> : 'Save and sign in'}
          </button>
          <p className="err">
            {error ||
              (mismatch ? "Those don't match." : password && password.length < 6 ? 'At least 6 characters.' : '')}
          </p>
        </form>
      </div>
    </div>
  );
}

/* ======================================================== create profile == */

export function CreateProfile({ onClose }: { onClose: () => void }) {
  const { signUp } = useSession();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]);
  const [color, setColor] = useState(COLOR_CHOICES[0]);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nameOk = name.trim().length >= 2;
  const pwOk = password.length >= 6;
  const matchOk = password === confirm;
  const emailOk = !email.trim() || /^\S+@\S+\.\S+$/.test(email.trim());
  const ready = nameOk && pwOk && matchOk && emailOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await signUp({
        displayName: name.trim(),
        password,
        email: email.trim() || undefined,
        emoji,
        color,
        avatarFile,
      });
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New profile"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent" onClick={submit} disabled={!ready || busy}>
            {busy ? <Spinner /> : 'Create profile'}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Display name">
          <input
            className="input"
            value={name}
            maxLength={24}
            placeholder="Sam"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {name.trim() && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '-8px 0 16px' }}>
            Signs in as <b>{slugify(name)}</b>
          </div>
        )}

        <AvatarEditor
          emoji={emoji}
          color={color}
          url={avatarPreview}
          onEmoji={setEmoji}
          onColor={setColor}
          onFile={(f) => {
            if (avatarPreview) URL.revokeObjectURL(avatarPreview);
            setAvatarFile(f);
            setAvatarPreview(URL.createObjectURL(f));
          }}
          onRemove={() => {
            if (avatarPreview) URL.revokeObjectURL(avatarPreview);
            setAvatarFile(null);
            setAvatarPreview(null);
          }}
        />

        <div className="two-col">
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm">
            <input
              className="input"
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Recovery email (optional, but the only way back in)">
          <input
            className="input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: -8, lineHeight: 1.5 }}>
          Skip it and the profile still works — but if you forget the password, there is no way to
          reset it and the profile has to be remade.
        </div>

        <p className="err">
          {error ||
            (!matchOk && confirm ? "Passwords don't match." : '') ||
            (password && !pwOk ? 'Password needs at least 6 characters.' : '') ||
            (!emailOk ? "That email doesn't look right." : '')}
        </p>
      </form>
    </Modal>
  );
}
