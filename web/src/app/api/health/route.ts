import { connection } from 'next/server';
import { getProviderConfiguration } from '@/lib/ai/providers';
import { isDatabaseReachable } from '@/lib/db/health';
import { getAuthEnv, isAzureSpeechConfigured } from '@/lib/env';

/**
 * GET /api/health: development-only readiness probe for the account setup docs.
 * Booleans only, never values. Unauthenticated, hence a 404 in production builds.
 */
export async function GET(): Promise<Response> {
  // Request-time on purpose: with Cache Components a handler that touches no
  // runtime data would otherwise be prerendered with the build machine's env.
  await connection();
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });

  return Response.json(
    {
      db: await isDatabaseReachable(),
      auth: getAuthEnv() !== null,
      ai: getProviderConfiguration(),
      tts: { azure: isAzureSpeechConfigured() },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
