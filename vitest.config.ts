import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Most suites are pure logic and run in node; the smoke test opts into a
    // DOM by filename.
    environment: 'node',
    environmentMatchGlobs: [['tests/**/*.dom.test.tsx', 'jsdom']],

    // Pin the app's config so the suite behaves the same on every machine and
    // never reaches a real Supabase project. Without this, whether the tests
    // pass depends on whether the developer happens to have filled in .env.
    env: {
      VITE_SUPABASE_URL: 'https://YOUR-PROJECT-ref.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_SITE_PASSWORD: 'cold',
    },
  },
});
