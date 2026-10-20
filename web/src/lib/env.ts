import 'server-only';
import { z } from 'zod';

const MongoEnvSchema = z.object({
  uri: z.string().regex(/^mongodb(\+srv)?:\/\/.+/, 'Expected a mongodb:// or mongodb+srv:// URI'),
});

const AuthEnvSchema = z.object({
  secret: z.string().min(32),
  url: z.url(),
});

export type MongoEnv = z.infer<typeof MongoEnvSchema>;
export type AuthEnv = z.infer<typeof AuthEnvSchema>;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('Database is not configured: set MONGODB_URI, BETTER_AUTH_SECRET and BETTER_AUTH_URL');
    this.name = 'DatabaseNotConfiguredError';
  }
}

/**
 * Env readers never throw and never run at import time, so the app can build and
 * render public pages without a .env file. Values are read on each call so tests
 * can change them.
 */
export function getMongoEnv(): MongoEnv | null {
  const parsed = MongoEnvSchema.safeParse({ uri: process.env.MONGODB_URI });
  return parsed.success ? parsed.data : null;
}

export function getAuthEnv(): AuthEnv | null {
  const parsed = AuthEnvSchema.safeParse({
    secret: process.env.BETTER_AUTH_SECRET,
    url: process.env.BETTER_AUTH_URL,
  });
  return parsed.success ? parsed.data : null;
}

/** True when both the database and the auth settings are present and valid. */
export function isDatabaseConfigured(): boolean {
  return getMongoEnv() !== null && getAuthEnv() !== null;
}

export function requireMongoEnv(): MongoEnv {
  const env = getMongoEnv();
  if (!env) throw new DatabaseNotConfiguredError();
  return env;
}

export function requireAuthEnv(): AuthEnv {
  const env = getAuthEnv();
  if (!env) throw new DatabaseNotConfiguredError();
  return env;
}
