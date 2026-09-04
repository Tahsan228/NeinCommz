import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { errText, slugify, supabase, syntheticEmail, uploadImage } from '../lib/supabase';
import { DEFAULT_PREFS, type Prefs, type Profile } from '../lib/types';

interface SessionApi {
  session: Session | null;
  profile: Profile | null;
  prefs: Prefs;
  loading: boolean;
  /** True when the user arrived from a password-reset email link. */
  recovering: boolean;
  signUp: (input: SignUpInput) => Promise<void>;
  signIn: (slug: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  completeReset: (password: string) => Promise<void>;
  savePrefs: (patch: Partial<Prefs>) => Promise<void>;
  saveProfile: (patch: Partial<Profile>) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export interface SignUpInput {
  displayName: string;
  password: string;
  email?: string;
  emoji: string;
  color: string;
  /** Optional uploaded picture; it replaces the emoji once it lands. */
  avatarFile?: File | null;
}

const Ctx = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  // Supabase drops the recovery token in the URL fragment. Catch it before
  // anything else so a reset link lands on the new-password screen instead of
  // silently signing the person in with a half-usable session.
  useEffect(() => {
    if (window.location.hash.includes('type=recovery')) setRecovering(true);
  }, []);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
      if (!s) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    setProfile(data as Profile | null);
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    (async () => {
      // The profile row is created by a database trigger the moment the auth
      // user appears, but on a brand-new signup the two can race by a few ms.
      for (let attempt = 0; attempt < 6 && !cancelled; attempt++) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();
        if (data) {
          if (!cancelled) setProfile(data as Profile);
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, session?.user]);

  const prefs = useMemo<Prefs>(
    () => ({ ...DEFAULT_PREFS, ...(profile?.prefs ?? {}) }),
    [profile?.prefs],
  );

  // Push the profile's look at the document so every screen, including
  // full-screen game overlays outside the normal tree, picks it up.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.density;
    root.style.setProperty('--font-size', `${prefs.fontSize}px`);
    const accent = profile?.accent_color || '#e0574f';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-hi', lighten(accent, 0.18));
    root.style.setProperty('--accent-lo', lighten(accent, -0.22));
    root.style.setProperty('--accent-glow', hexAlpha(accent, 0.16));
    root.style.setProperty('--accent-ink', readableInk(accent));
  }, [prefs.theme, prefs.density, prefs.fontSize, profile?.accent_color]);

  const signUp = useCallback(async (input: SignUpInput) => {
    const slug = slugify(input.displayName);
    const email = input.email?.trim() || syntheticEmail(slug);

    const { error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: {
        data: {
          slug,
          display_name: input.displayName.trim(),
          avatar_emoji: input.emoji,
          avatar_color: input.color,
          accent_color: input.color,
          has_recovery: Boolean(input.email?.trim()),
        },
      },
    });
    if (error) throw new Error(errText(error));

    // With email confirmation switched on there is no session yet, and the
    // profile would exist with no way to reach it. Say so plainly instead of
    // dumping the person on a blank screen.
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw new Error(
        'Profile created, but this Supabase project requires email confirmation. ' +
          'Confirm the email, or turn off "Confirm email" in Authentication > Providers.',
      );
    }

    // The picture can only be uploaded once a session exists, so it happens
    // here rather than in the signUp call. A failure is not worth blocking the
    // account on — the picture can be set again from Settings.
    if (input.avatarFile) {
      const uid = data.session.user.id;
      try {
        const url = await uploadImage(input.avatarFile, 'avatars', uid);
        // The profile row arrives via trigger, which can lag the session by a
        // few milliseconds; retry until the update actually matches a row.
        for (let attempt = 0; attempt < 8; attempt++) {
          const { data: rows } = await supabase
            .from('profiles')
            .update({ avatar_url: url })
            .eq('id', uid)
            .select('id');
          if (rows && rows.length > 0) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        /* keep the account; the emoji stands in until they retry */
      }
    }
  }, []);

  const signIn = useCallback(async (slug: string, password: string) => {
    // Look up which address this account actually signs in under. The function
    // only answers callers who already supplied the right password.
    const { data: email, error: rpcError } = await supabase.rpc('login_email', {
      p_slug: slug,
      p_password: password,
    });
    if (rpcError) throw new Error(errText(rpcError));
    if (!email) throw new Error('Wrong password.');

    const { error } = await supabase.auth.signInWithPassword({
      email: email as string,
      password,
    });
    if (error) throw new Error(errText(error));
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const sendReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) throw new Error(errText(error));
  }, []);

  const completeReset = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(errText(error));
    setRecovering(false);
    history.replaceState(null, '', window.location.pathname);
  }, []);

  const savePrefs = useCallback(
    async (patch: Partial<Prefs>) => {
      if (!profile) return;
      const next = { ...prefs, ...patch };
      setProfile({ ...profile, prefs: next });
      const { error } = await supabase.from('profiles').update({ prefs: next }).eq('id', profile.id);
      if (error) throw new Error(errText(error));
    },
    [profile, prefs],
  );

  const saveProfile = useCallback(
    async (patch: Partial<Profile>) => {
      if (!profile) return;
      setProfile({ ...profile, ...patch });
      const { error } = await supabase.from('profiles').update(patch).eq('id', profile.id);
      if (error) throw new Error(errText(error));
    },
    [profile],
  );

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (!profile) return;
      // Re-check the current password rather than trusting the live session,
      // so a walk-up on an unlocked screen cannot silently take the account.
      const { data: email } = await supabase.rpc('login_email', {
        p_slug: profile.slug,
        p_password: current,
      });
      if (!email) throw new Error('Current password is not right.');
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw new Error(errText(error));
    },
    [profile],
  );

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session?.user, loadProfile]);

  const value = useMemo(
    () => ({
      session,
      profile,
      prefs,
      loading,
      recovering,
      signUp,
      signIn,
      signOut,
      sendReset,
      completeReset,
      savePrefs,
      saveProfile,
      changePassword,
      refreshProfile,
    }),
    [
      session, profile, prefs, loading, recovering, signUp, signIn, signOut,
      sendReset, completeReset, savePrefs, saveProfile, changePassword, refreshProfile,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}

/* ------------------------------------------------------------- colour ---- */

function clamp(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

export function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const t = amount > 0 ? 255 : 0;
  const p = Math.abs(amount);
  const mix = (c: number) => clamp(c + (t - c) * p);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function hexAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Black or white text, whichever survives on this background. */
export function readableInk(hex: string): string {
  const [r, g, b] = parseHex(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#14141a' : '#ffffff';
}
