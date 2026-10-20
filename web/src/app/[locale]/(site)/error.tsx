'use client'; // Error boundaries must be Client Components.

import { ErrorScreen } from '@/components/shell/ErrorScreen';

export default function SiteError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
