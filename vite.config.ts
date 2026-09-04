import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import gifsHandler from './api/gifs';

/**
 * Serve the /api/gifs edge function during `npm run dev`.
 *
 * Vercel runs `api/gifs.ts` for us in production, but the plain Vite dev server
 * knows nothing about it. Rather than reimplement the endpoint, this adapts the
 * Node request into a web `Request` and hands it to the very same handler, so
 * local and deployed behaviour cannot drift apart. The key stays server-side in
 * development too — it is never handed to the browser.
 */
function giphyDevApi(key: string): Plugin {
  return {
    name: 'giphy-dev-api',
    apply: 'serve',
    configureServer(server) {
      if (key) process.env.GIPHY_KEY = key;

      server.middlewares.use('/api/gifs', async (req, res) => {
        try {
          // Mounted middleware sees only the path remainder, e.g. "/?q=cat".
          const request = new Request(`http://localhost/api/gifs${req.url ?? ''}`);
          const response = await gifsHandler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(await response.text());
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'dev', message: String(e) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The empty prefix loads every variable, not just VITE_ ones, so the
  // server-only GIPHY_KEY is visible here without becoming visible to clients.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), giphyDevApi(env.GIPHY_KEY)],
    server: { port: 5173 },
  };
});
