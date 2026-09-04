import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from './session';
import { useToasts } from './toasts';

/**
 * The cheat code.
 *
 * Tap the logo twice, then click into the message box: 10,000 coins. It is
 * deliberately a two-step gesture in two different corners of the screen so
 * nobody trips over it, and it arms for only a few seconds so a stray
 * double-click hours ago cannot fire it later.
 *
 * The coins themselves come from a database function like every other change
 * to a wallet — a client that can write its own balance is not a wallet.
 */

interface SecretApi {
  /** Call on a logo click. Two within the window arms the code. */
  tapLogo: () => void;
  /** Call when the composer is focused. Fires if armed. */
  enterComposer: () => void;
  armed: boolean;
}

const Ctx = createContext<SecretApi | null>(null);

const DOUBLE_TAP_MS = 700;
const ARMED_FOR_MS = 6000;

export function SecretProvider({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useSession();
  const { push } = useToasts();

  const lastTap = useRef(0);
  const armedUntil = useRef(0);
  const claiming = useRef(false);
  const [armed, setArmed] = useState(false);

  const tapLogo = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      armedUntil.current = now + ARMED_FOR_MS;
      setArmed(true);
      window.setTimeout(() => {
        if (Date.now() >= armedUntil.current) setArmed(false);
      }, ARMED_FOR_MS + 50);
    } else {
      lastTap.current = now;
    }
  }, []);

  const enterComposer = useCallback(() => {
    if (Date.now() > armedUntil.current || claiming.current || !profile) return;
    claiming.current = true;
    armedUntil.current = 0;
    setArmed(false);

    void (async () => {
      const { error } = await supabase.rpc('secret_bonus');
      if (error) {
        push({ icon: 'ban', title: 'That did nothing', sub: error.message });
      } else {
        await refreshProfile();
        push({
          icon: 'coin',
          title: '+10,000 coins',
          sub: 'You saw nothing.',
          ms: 5000,
        });
      }
      claiming.current = false;
    })();
  }, [profile, push, refreshProfile]);

  const value = useMemo(() => ({ tapLogo, enterComposer, armed }), [tapLogo, enterComposer, armed]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSecret(): SecretApi {
  const c = useContext(Ctx);
  // The composer and the logo both live under the provider, but a test that
  // mounts one alone should not explode over an easter egg.
  return c ?? { tapLogo: () => {}, enterComposer: () => {}, armed: false };
}
