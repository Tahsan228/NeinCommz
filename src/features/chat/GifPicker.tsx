import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';

export interface GifPick {
  url: string;
  w: number;
  h: number;
}

/**
 * GIF search.
 *
 * This component holds no API key. It calls /api/gifs, a server function that
 * keeps the Giphy key out of the JavaScript bundle entirely — see api/gifs.ts.
 * If the server has no key configured it answers 503 and the picker falls back
 * to pasting a GIF link, which is how most GIFs get shared anyway.
 */
export function GifPicker({ onPick, onClose }: { onPick: (g: GifPick) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  /** Flips to false when the server tells us it has no key configured. */
  const [searchable, setSearchable] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Debounced search. An empty box shows trending, so the panel is never blank.
  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();

    const t = window.setTimeout(async () => {
      setBusy(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '24' });
        if (query.trim()) params.set('q', query.trim());

        const res = await fetch(`/api/gifs?${params}`, { signal: controller.signal });

        if (res.status === 503) {
          // No key on the server. Drop to paste-a-link rather than showing an
          // error nobody looking at this screen can do anything about.
          setSearchable(false);
          return;
        }
        if (!res.ok) throw new Error(`Search failed (${res.status}).`);

        const json = (await res.json()) as { gifs?: GifPick[] };
        setResults(json.gifs ?? []);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError(e instanceof Error ? e.message : 'GIF search failed.');
        }
      } finally {
        setBusy(false);
      }
    }, 320);

    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [query, searchable]);

  const submitPaste = (e: React.FormEvent) => {
    e.preventDefault();
    const url = paste.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('That needs to be a full https:// link to an image or GIF.');
      return;
    }
    onPick({ url, w: 0, h: 0 });
  };

  return (
    <div className="gif-pop" ref={boxRef}>
      {searchable ? (
        <>
          <div style={{ position: 'relative' }}>
            <Icon
              name="search"
              size={16}
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-faint)',
                pointerEvents: 'none',
              }}
            />
            <input
              className="input"
              style={{ paddingLeft: 34 }}
              autoFocus
              placeholder="Search GIFs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {busy && <p className="row-sub" style={{ marginTop: 8 }}>Searching…</p>}
          {error && <p className="err">{error}</p>}

          {!busy && !error && results.length === 0 && (
            <p className="row-sub" style={{ marginTop: 8 }}>No GIFs for that.</p>
          )}

          <div className="gif-results">
            {results.map((g) => (
              <img key={g.url} src={g.url} alt="" loading="lazy" onClick={() => onPick(g)} />
            ))}
          </div>

          {/* Giphy's terms ask for attribution wherever their results appear. */}
          <div className="attrib">Powered by GIPHY</div>
        </>
      ) : (
        <form onSubmit={submitPaste}>
          <div className="label" style={{ padding: '0 0 8px' }}>Paste a GIF link</div>
          <input
            className="input"
            autoFocus
            placeholder="https://…/thing.gif"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '8px 0 0', lineHeight: 1.5 }}>
            Set <code>GIPHY_KEY</code> on the server to search GIFs from right here instead.
          </p>
          {error && <p className="err">{error}</p>}
          <button className="btn btn-accent btn-sm" style={{ marginTop: 10 }} type="submit">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
