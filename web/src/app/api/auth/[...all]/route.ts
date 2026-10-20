import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth/auth';
import { isDatabaseConfigured } from '@/lib/env';

function handle(method: 'GET' | 'POST') {
  return (request: Request) => {
    if (!isDatabaseConfigured()) {
      return Response.json({ error: 'database_not_configured' }, { status: 503 });
    }
    return toNextJsHandler(getAuth())[method](request);
  };
}

export const GET = handle('GET');
export const POST = handle('POST');
