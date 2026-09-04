import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

export interface Toast {
  id: number;
  title: string;
  sub?: string;
  icon?: IconName;
  /** Optional inline action, used by game invites. */
  action?: { label: string; run: () => void };
  ms?: number;
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  toasts: Toast[];
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { ...t, id }]);
      const ms = t.ms ?? 6000;
      if (ms > 0) window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss, toasts }), [push, dismiss, toasts]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToasts(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToasts outside ToastProvider');
  return c;
}

export function ToastHost() {
  const { toasts, dismiss } = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          {t.icon && (
            <div
              style={{
                width: 34,
                height: 34,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 10,
                background: 'var(--sunken)',
                boxShadow: 'var(--inset)',
              }}
            >
              <Icon name={t.icon} size={17} />
            </div>
          )}
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.sub && <div className="toast-sub">{t.sub}</div>}
          </div>
          {t.action && (
            <button
              className="btn btn-accent btn-sm"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="btn btn-ghost btn-icon" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="x" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
