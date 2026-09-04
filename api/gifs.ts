/**
 * Server-side Giphy proxy.
 *
 * The point of this file is that the Giphy key never reaches a browser. A
 * `VITE_`-prefixed variable is inlined into the JavaScript bundle at build
 * time, so anyone can read it in devtools — moving the key out of the repo
 * would have hidden it from GitHub and nowhere else. `GIPHY_KEY` has no VITE_
 * prefix, so it exists only here, on the server.
 *
 * Runs as a Vercel Edge Function in production and, via a small middleware in
 * vite.config.ts, as the same handler during local development — one
 * implementation, so the two cannot drift.
 */

export const config = { runtime: 'edge' };

interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

interface GiphyGif {
  images?: { fixed_width?: GiphyImage; downsized?: GiphyImage };
}

export interface GifResult {
  url: string;
  w: number;
  h: number;
}

const MAX_LIMIT = 30;
const MAX_QUERY = 100;

function json(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Trending is identical for everyone, so let the edge cache carry it and
      // spare the quota. Searches vary too much to be worth caching here.
      'cache-control': cacheSeconds
        ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=600`
        : 'no-store',
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  const key = process.env.GIPHY_KEY;
  if (!key) {
    // Not an error the user caused, so say what is actually wrong. The picker
    // falls back to pasting a link when it sees this.
    return json({ error: 'no-key', message: 'GIPHY_KEY is not set on the server.' }, 503);
  }

  const params = new URL(request.url).searchParams;
  const query = (params.get('q') ?? '').trim().slice(0, MAX_QUERY);
  const limit = Math.min(Math.max(Number(params.get('limit')) || 24, 1), MAX_LIMIT);

  // Only two endpoints are reachable, both with a fixed rating. Nothing from
  // the query string is allowed to choose the upstream URL.
  const upstream = new URL(
    query ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending',
  );
  upstream.searchParams.set('api_key', key);
  upstream.searchParams.set('limit', String(limit));
  upstream.searchParams.set('rating', 'pg-13');
  upstream.searchParams.set('bundle', 'messaging_non_clips');
  if (query) upstream.searchParams.set('q', query);

  let res: Response;
  try {
    res = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
  } catch {
    return json({ error: 'upstream', message: 'Could not reach Giphy.' }, 502);
  }

  if (!res.ok) {
    return json({ error: 'upstream', message: `Giphy returned ${res.status}.` }, 502);
  }

  const body = (await res.json()) as { data?: GiphyGif[] };

  // Hand back only what the picker draws. Giphy's payload is large and full of
  // fields the client has no business seeing.
  const gifs: GifResult[] = (body.data ?? [])
    .map((g) => {
      const img = g.images?.fixed_width ?? g.images?.downsized;
      return img ? { url: img.url, w: Number(img.width) || 0, h: Number(img.height) || 0 } : null;
    })
    .filter((x): x is GifResult => x !== null);

  return json({ gifs }, 200, query ? 0 : 900);
}
