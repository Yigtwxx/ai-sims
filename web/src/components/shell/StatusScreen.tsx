import type { ReactNode } from 'react';

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
 * Shared layout for not-found and error states: an empty lit stage with the
 * message set like a title card in the dark part of the frame.
 */
export function StatusScreen({ title, body, children, footnote, className }: StatusScreenProps) {
  return (
    <section
      className={cn(
        'relative isolate flex min-h-[calc(100dvh-var(--header-h))] items-end overflow-hidden',
        className,
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(60%_70%_at_70%_20%,rgb(255_226_176/0.10),transparent_70%)]" />
        {/* Blur on the wrapper so the clipped beam gets soft edges. */}
        <div className="absolute top-0 left-[58%] h-[90%] w-[34%] -translate-x-1/2 blur-2xl">
          <div className="size-full bg-[linear-gradient(to_bottom,rgb(255_226_176/0.16),rgb(255_226_176/0.03)_70%,transparent)] [clip-path:polygon(44%_0,56%_0,100%_100%,0_100%)]" />
        </div>
        <div className="absolute bottom-[10%] left-[58%] h-24 w-[46%] -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(255_226_176/0.16),transparent)]" />
      </div>
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
