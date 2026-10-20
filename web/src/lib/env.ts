import { z } from 'zod';

const SupabaseEnvSchema = z.object({
  url: z.url(),
  anonKey: z.string().min(1),
});

export type SupabaseEnv = z.infer<typeof SupabaseEnvSchema>;

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
    this.name = 'SupabaseNotConfiguredError';
  }
}

/**
 * Returns validated Supabase settings, or null when they are missing/invalid.
 * Never throws, so the app can build and render public pages without a .env.
 * NEXT_PUBLIC_* values must be referenced literally so Next.js inlines them in client bundles.
 */
export function getSupabaseEnv(): SupabaseEnv | null {
  const parsed = SupabaseEnvSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return parsed.success ? parsed.data : null;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

/** Like getSupabaseEnv but throws SupabaseNotConfiguredError; for code that cannot proceed without it. */
export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  return env;
}
