import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import type { Message } from './lib/types';
import { formatClock } from './lib/time';
import { useSession } from './state/session';
import { useDirectory } from './state/directory';
import { ToastHost } from './state/toasts';
import { Avatar, Panel, Spinner } from './components/ui';
import { Icon } from './components/Icon';
import { Logo } from './components/Logo';
import { useSecret } from './state/secret';
import { SiteGate } from './features/gate/SiteGate';
import {
  CreateProfile,
  PasswordPrompt,
  ProfilePicker,
  ResetPasswordScreen,
} from './features/profiles/ProfileScreens';
import type { PublicProfile } from './lib/types';
import { ChatColumn } from './features/chat/ChatColumn';
import { GamesPanel } from './features/games/GamesPanel';
import { StatusBoard } from './features/status/StatusBoard';
import { Dashboard } from './features/dashboard/Dashboard';
import { QuickStatus } from './features/status/QuickStatus';
import { Shop } from './features/economy/Shop';
import { Leaderboards } from './features/economy/Leaderboards';
import { LeaderboardWidget } from './features/economy/LeaderboardWidget';
import { SettingsModal } from './features/settings/SettingsModal';

export default function App() {
  const { session, profile, loading, authReady, recovering } = useSession();
  // Starts false on every load, so the front door is asked for each visit.
  const [gated, setGated] = useState(false);
  const [picking, setPicking] = useState<PublicProfile | null>(null);
  const [creating, setCreating] = useState(false);

  // A reset link has to win over everything: the person following it cannot
  // get past the profile screen until they have set a new password.
  if (recovering) return <ResetPasswordScreen />;

  if (!gated) return <SiteGate onPass={() => setGated(true)} />;

  // Sessions are not persisted, so this normally resolves to "signed out"
  // immediately — but it still has to resolve before we decide, or a password
  // reset link would be shown the picker for a frame first.
  if (!authReady) {
    return (
      <div className="centered">
        <Spinner />
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <ProfilePicker onPick={setPicking} onCreate={() => setCreating(true)} />
        {picking && <PasswordPrompt target={picking} onClose={() => setPicking(null)} />}
        {creating && <CreateProfile onClose={() => setCreating(false)} />}
      </>
    );
  }

  if (loading || !profile) {
    return (
      <div className="centered">
        <Spinner />
      </div>
    );
  }

  return <Home />;
}

function Home() {
  const { profile, prefs } = useSession();
  const { online } = useDirectory();
  const { tapLogo, armed } = useSecret();
  const [settings, setSettings] = useState(false);
  const [shop, setShop] = useState(false);
  const [boards, setBoards] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), prefs.showSeconds ? 1000 : 20_000);
    return () => window.clearInterval(id);
  }, [prefs.showSeconds]);

  useMessageAlerts();

  if (!profile) return null;

  return (
    <div className="shell">
      {!online && <div className="banner">Reconnecting… messages you send will queue up.</div>}

      <div className="topbar">
        <button className="logo-btn" onClick={tapLogo} data-armed={armed} aria-label="NeinCommz">
          <Logo size={26} />
        </button>
        <div className="topbar-spacer" />
        <div className="clock">{formatClock(now, prefs.clock24, prefs.showSeconds)}</div>

        {/* Changing what you're up to is the most frequent thing anyone does
            here, so it sits in the corner rather than inside settings. */}
        <QuickStatus />

        <button className="coin-pill coin-pill-btn" title="Shop" onClick={() => setShop(true)}>
          <Icon name="coin" size={14} />
          {profile.coins.toLocaleString()}
        </button>

        <button className="me-chip" onClick={() => setSettings(true)} title="Settings">
          <Avatar
            emoji={profile.avatar_emoji}
            url={profile.avatar_url}
            color={profile.avatar_color}
            size={26}
            name={profile.display_name}
          />
          {profile.display_name}
          <Icon name="settings" size={14} style={{ color: 'var(--ink-faint)' }} />
        </button>
      </div>

      <div className="columns">
        <Panel label="Chat" className="column-chat">
          <ChatColumn />
        </Panel>

        <Panel label="Games" className="column-games">
          <GamesPanel />
        </Panel>

        <div className="column column-status">
          <div className="label">Who's around</div>
          <div className="panel panel-grow">
            <Dashboard />
            <StatusBoard />
          </div>

          <div className="label" style={{ paddingTop: 14 }}>
            Leaderboard
          </div>
          <div className="panel">
            <LeaderboardWidget onExpand={() => setBoards(true)} />
          </div>
        </div>
      </div>

      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {shop && <Shop onClose={() => setShop(false)} />}
      {boards && <Leaderboards onClose={() => setBoards(false)} />}
      <ToastHost />
    </div>
  );
}

/**
 * Sound and desktop notifications for messages that arrive while you are
 * looking somewhere else. Deliberately its own subscription rather than a hook
 * inside the chat panel, so alerts keep working with a game overlay open.
 */
function useMessageAlerts() {
  const { profile, prefs } = useSession();
  const { byId } = useDirectory();

  useEffect(() => {
    if (!profile) return;

    const ch = supabase
      .channel('alerts:main')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new as Message;
          if (m.author_id === profile.id) return;

          if (prefs.sounds) chime(prefs.volume / 100);

          if (prefs.notifications && document.hidden && 'Notification' in window) {
            if (Notification.permission === 'granted') {
              const who = byId.get(m.author_id)?.display_name ?? 'Someone';
              new Notification(who, {
                body: m.body ?? (m.kind === 'gif' ? 'sent a GIF' : 'sent a photo'),
                tag: 'neincommz',
              });
            }
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [profile, prefs.sounds, prefs.volume, prefs.notifications, byId]);
}

let audioCtx: AudioContext | null = null;

/** A short two-note blip. Cheaper and less annoying than shipping an mp3. */
function chime(volume: number) {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const now = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.13), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    gain.connect(audioCtx.destination);

    for (const [freq, at] of [
      [660, 0],
      [880, 0.08],
    ] as const) {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + at);
      osc.connect(gain);
      osc.start(now + at);
      osc.stop(now + at + 0.14);
    }
  } catch {
    /* autoplay blocked until the first interaction; nothing to do */
  }
}
