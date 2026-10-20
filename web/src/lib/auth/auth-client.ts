import { anonymousClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Browser-side auth client. Same-origin, so no baseURL is needed. */
export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});
