'use client'; // Error boundaries must be Client Components.

import { ErrorScreen } from '@/components/shell/ErrorScreen';

/** Catches errors in the site chrome and in full-screen routes (creator) below the root layout. */
export default function LocaleError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
