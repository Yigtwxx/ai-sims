import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';

import { getSession } from '@/lib/auth/session';

export interface Viewer {
  signedIn: boolean;
}

/**
 * The current visitor as the shell needs it (signed in or not), read once per
 * request. Waits for the request first, so prerendering stops before the auth
 * client is created (it reads the clock). A database outage must not take the
 * header down, so a failed lookup renders the signed-out shell; Next.js
 * control-flow errors are rethrown. Call it only inside a <Suspense> boundary.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  await connection();
  try {
    return { signedIn: (await getSession()) !== null };
  } catch (error) {
    unstable_rethrow(error);
    return { signedIn: false };
  }
});
