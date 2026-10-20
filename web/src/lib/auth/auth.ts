import 'server-only';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { nextCookies } from 'better-auth/next-js';
import { anonymous } from 'better-auth/plugins';
import { getDb } from '@/lib/db/mongo';
import { requireAuthEnv } from '@/lib/env';

function createAuth() {
  const { secret, url } = requireAuthEnv();

  return betterAuth({
    secret,
    baseURL: url,
    // No `client` option: it enables transactions, which need a replica set
    // (the local dev mongod is standalone).
    database: mongodbAdapter(getDb()),
    // Email/password is off for now; the anonymous user can be upgraded later.
    emailAndPassword: { enabled: false },
    // nextCookies must stay the last plugin.
    plugins: [anonymous(), nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as typeof globalThis & { __auth?: Auth };

/**
 * Lazily creates the Better Auth instance so importing this module never
 * requires env vars (builds and public pages work without a database).
 * Throws DatabaseNotConfiguredError when env is missing.
 */
export function getAuth(): Auth {
  globalForAuth.__auth ??= createAuth();
  return globalForAuth.__auth;
}
