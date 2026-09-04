import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True once .env actually points at a project. Screens degrade politely if not. */
export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'));

export const supabase: SupabaseClient = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 40 } },
  },
);

export const SITE_PASSWORD = (import.meta.env.VITE_SITE_PASSWORD as string) || 'cold';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Put a file in the public media bucket and hand back its URL. Used for both
 * chat attachments and profile pictures; the folder keeps them apart.
 */
export async function uploadImage(
  file: File,
  folder: string,
  ownerId: string,
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That needs to be an image.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is over 8 MB.');

  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${folder}/${ownerId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('media')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

/**
 * Profiles are Netflix tiles on the surface but real auth accounts underneath.
 * People who supply a recovery email sign in with it directly, which is what
 * makes Supabase's built-in password-reset email work. People who skip it get
 * a synthetic address derived from their slug — they can still sign in, they
 * just have no way back if they forget the password.
 */
export function syntheticEmail(slug: string): string {
  return `${slug}@neincommz.local`;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'friend'
  );
}

/** Supabase errors are objects, not Errors. Squeeze out something readable. */
export function errText(e: unknown): string {
  if (!e) return 'Something went wrong.';
  if (typeof e === 'string') return e;
  const m = (e as { message?: string }).message;
  if (!m) return 'Something went wrong.';
  if (m.includes('Invalid login credentials')) return 'Wrong password.';
  if (m.includes('User already registered')) return 'That name is already taken.';
  if (m.includes('duplicate key')) return 'That name is already taken.';
  if (m.includes('Password should be')) return 'Password must be at least 6 characters.';
  if (m.includes('Failed to fetch')) return 'Can not reach the server. Check your connection.';
  return m;
}
