import type { ReactNode } from 'react';

import { DustField } from '@/components/stage/DustField';
import { cn } from '@/lib/utils';

interface StatusScreenProps {
  title: string;
  body: string;
  /** Actions (links, retry button). */
  children?: ReactNode;
  /** Small print under the actions, e.g. an error digest. */
  footnote?: string;
  className?: string;
}

/**
 * Shared layout for not-found and error states: the landing's scattered dots
 * (nothing has formed here) with the message set bottom-left like a chapter.
 */
export function StatusScreen({ title, body, children, footnote, className }: StatusScreenProps) {
  return (
    <section
      className={cn(
        'relative isolate flex min-h-[calc(100dvh-var(--header-h))] items-end overflow-hidden',
        className,
      )}
    >
      <DustField className="pointer-events-none absolute inset-0 -z-10 size-full" />
      <div className="mx-auto w-full max-w-[1440px] px-5 pt-24 pb-16 md:px-8 md:pb-24 lg:px-12">
        <h1 className="font-headline text-headline text-ink max-w-[16ch]">{title}</h1>
        <p className="text-lede text-ink-muted mt-4 max-w-[46ch]">{body}</p>
        {children ? <div className="mt-8 flex flex-wrap items-center gap-3">{children}</div> : null}
        {footnote ? (
          <p className="text-label text-ink-faint mt-6 tabular-nums">{footnote}</p>
        ) : null}
      </div>
    </section>
  );
}
