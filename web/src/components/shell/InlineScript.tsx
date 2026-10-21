'use client';

/**
 * A script that runs once during HTML parsing (before first paint). On the
 * client it renders as inert `text/plain`, so React never tries to execute or
 * warn about it when it re-renders the tree (e.g. after an error boundary).
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
