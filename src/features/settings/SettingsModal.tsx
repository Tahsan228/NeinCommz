import { useState } from 'react';
import { errText, uploadImage } from '../../lib/supabase';
import type { Prefs } from '../../lib/types';
import { useSession } from '../../state/session';
import { Field, Modal, Row, Slider, Toggle } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { ScheduleEditor } from '../schedule/ScheduleEditor';
import { AvatarEditor, COLOR_CHOICES } from '../profiles/ProfileScreens';

type Tab = 'profile' | 'look' | 'chat' | 'schedule' | 'account';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'profile', label: 'Profile', icon: 'smile' },
  { id: 'look', label: 'Appearance', icon: 'palette' },
  { id: 'chat', label: 'Chat', icon: 'message' },
  { id: 'schedule', label: 'Schedule', icon: 'calendar' },
  { id: 'account', label: 'Account', icon: 'lock' },
];

const THEMES: { id: Prefs['theme']; label: string; swatch: string }[] = [
  { id: 'graphite', label: 'Graphite', swatch: '#212127' },
  { id: 'midnight', label: 'Midnight', swatch: '#182034' },
  { id: 'forest', label: 'Forest', swatch: '#15271c' },
  { id: 'plum', label: 'Plum', swatch: '#261a2d' },
  { id: 'paper', label: 'Paper', swatch: '#f4f4f6' },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { profile, prefs, savePrefs, saveProfile, signOut, changePassword } = useSession();
  const [tab, setTab] = useState<Tab>('profile');
  const [uploading, setUploading] = useState(false);

  if (!profile) return null;
  const set = (patch: Partial<Prefs>) => void savePrefs(patch);

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-nav" style={{ margin: '-18px -18px 18px' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className="settings-tab"
            data-on={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          <Field label="Display name">
            <input
              className="input"
              value={profile.display_name}
              maxLength={24}
              onChange={(e) => void saveProfile({ display_name: e.target.value })}
            />
          </Field>

          <Field label="Bio">
            <textarea
              className="input"
              rows={3}
              maxLength={280}
              placeholder="Anything you want people to know."
              style={{ resize: 'vertical', lineHeight: 1.5 }}
              defaultValue={profile.bio ?? ''}
              onBlur={(e) => void saveProfile({ bio: e.target.value.trim() || null })}
            />
          </Field>

          <AvatarEditor
            emoji={profile.avatar_emoji}
            color={profile.avatar_color}
            url={profile.avatar_url}
            busy={uploading}
            onEmoji={(e) => void saveProfile({ avatar_emoji: e })}
            onColor={(c) => void saveProfile({ avatar_color: c })}
            onFile={async (f) => {
              setUploading(true);
              try {
                const url = await uploadImage(f, 'avatars', profile.id);
                await saveProfile({ avatar_url: url });
              } finally {
                setUploading(false);
              }
            }}
            onRemove={() => void saveProfile({ avatar_url: null })}
          />

          <Field label="Accent colour">
            <div className="swatches">
              {COLOR_CHOICES.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  style={{ ['--sw' as string]: c }}
                  data-sel={c === profile.accent_color}
                  onClick={() => void saveProfile({ accent_color: c })}
                  aria-label={`Accent colour ${c}`}
                />
              ))}
            </div>
          </Field>
          <p className="row-sub" style={{ marginTop: -8 }}>
            The accent tints buttons, your own message bubbles, and the glow behind the page.
          </p>
        </>
      )}

      {tab === 'look' && (
        <>
          <div className="label">Theme</div>
          <div className="group" style={{ marginBottom: 18 }}>
            {THEMES.map((t) => (
              <Row key={t.id} title={t.label} onClick={() => set({ theme: t.id })}>
                <span
                  style={{
                    width: 34,
                    height: 22,
                    borderRadius: 7,
                    background: t.swatch,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 2px 5px rgba(0,0,0,0.4)',
                    border: prefs.theme === t.id ? '2px solid var(--accent)' : '1px solid var(--edge)',
                  }}
                />
              </Row>
            ))}
          </div>

          <div className="label">Text</div>
          <div className="group">
            <Row title="Font size" sub={`${prefs.fontSize}px`}>
              <Slider
                label="Font size"
                value={prefs.fontSize}
                min={12}
                max={19}
                onChange={(v) => set({ fontSize: v })}
              />
            </Row>
            <Row title="Message density" sub="How tightly bubbles stack">
              <select
                className="select"
                style={{ width: 130 }}
                value={prefs.density}
                onChange={(e) => set({ density: e.target.value as Prefs['density'] })}
              >
                <option value="comfy">Comfy</option>
                <option value="compact">Compact</option>
              </select>
            </Row>
            <Row title="Bubble tails" sub="The little iMessage point on the last bubble">
              <Toggle label="Bubble tails" on={prefs.bubbleTails} onChange={(v) => set({ bubbleTails: v })} />
            </Row>
            <Row title="24-hour clock">
              <Toggle label="24-hour clock" on={prefs.clock24} onChange={(v) => set({ clock24: v })} />
            </Row>
            <Row title="Show seconds" sub="On the clock in the top bar">
              <Toggle label="Show seconds" on={prefs.showSeconds} onChange={(v) => set({ showSeconds: v })} />
            </Row>
          </div>
        </>
      )}

      {tab === 'chat' && (
        <>
          <div className="label">Sending</div>
          <div className="group" style={{ marginBottom: 18 }}>
            <Row title="Enter sends" sub={prefs.sendOnEnter ? 'Shift+Enter for a new line' : 'Ctrl+Enter sends instead'}>
              <Toggle label="Enter sends" on={prefs.sendOnEnter} onChange={(v) => set({ sendOnEnter: v })} />
            </Row>
            <Row title="Jump to newest" sub="Scroll down automatically when a message arrives">
              <Toggle label="Jump to newest" on={prefs.autoScroll} onChange={(v) => set({ autoScroll: v })} />
            </Row>
          </div>

          <div className="label">Alerts</div>
          <div className="group">
            <Row title="Sounds">
              <Toggle label="Sounds" on={prefs.sounds} onChange={(v) => set({ sounds: v })} />
            </Row>
            <Row title="Volume" sub={`${prefs.volume}%`}>
              <Slider
                label="Volume"
                value={prefs.volume}
                onChange={(v) => set({ volume: v })}
              />
            </Row>
            <Row title="Desktop notifications" sub="Only while this tab is in the background">
              <Toggle
                label="Desktop notifications"
                on={prefs.notifications}
                onChange={async (v) => {
                  if (v && 'Notification' in window) {
                    const res = await Notification.requestPermission();
                    if (res !== 'granted') return;
                  }
                  set({ notifications: v });
                }}
              />
            </Row>
          </div>

          <div className="label" style={{ marginTop: 18 }}>
            Presence
          </div>
          <div className="group">
            <Row title="Share my status" sub="Turn off and you always show as away">
              <Toggle label="Share my status" on={prefs.shareStatus} onChange={(v) => set({ shareStatus: v })} />
            </Row>
            <Row title="Away after" sub={`${prefs.awayAfterMin} minutes of no input`}>
              <Slider
                label="Away after"
                value={prefs.awayAfterMin}
                min={1}
                max={30}
                onChange={(v) => set({ awayAfterMin: v })}
              />
            </Row>
          </div>
        </>
      )}

      {tab === 'schedule' && <ScheduleEditor />}

      {tab === 'account' && <AccountTab onSignOut={() => void signOut()} change={changePassword} />}
    </Modal>
  );
}

function AccountTab({
  onSignOut,
  change,
}: {
  onSignOut: () => void;
  change: (current: string, next: string) => Promise<void>;
}) {
  const { profile } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = current.length > 0 && next.length >= 6 && next === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await change(current, next);
      setMsg('Password changed.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="group" style={{ marginBottom: 18 }}>
        <Row title="Signs in as" sub={profile?.slug} />
        <Row
          title="Password recovery"
          sub={
            profile?.has_recovery
              ? 'A recovery email is on file, so you can reset from the sign-in screen.'
              : 'No recovery email. Forget this password and the profile has to be remade.'
          }
        />
      </div>

      <div className="label">Change password</div>
      <form className="group" style={{ padding: 14 }} onSubmit={submit}>
        <Field label="Current password">
          <input
            className="input"
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <div className="two-col">
          <Field label="New password">
            <input
              className="input"
              type="password"
              value={next}
              autoComplete="new-password"
              onChange={(e) => setNext(e.target.value)}
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
        <button className="btn btn-accent btn-sm" disabled={!ready || busy}>
          Change password
        </button>
        <p className="err" style={{ color: error ? '#ff9089' : '#4fd695' }}>
          {error || msg}
        </p>
      </form>

      <button className="btn btn-danger" style={{ marginTop: 18 }} onClick={onSignOut}>
        <Icon name="logout" size={16} />
        Sign out
      </button>
    </>
  );
}
