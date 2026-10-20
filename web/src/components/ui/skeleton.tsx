import { cn } from '@/lib/utils';

/*
 * shadcn/ui Skeleton, restyled: a raised block with a slow tungsten light
 * sweep instead of a pulse (frozen under reduced motion by the global rule).
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'rounded-tile bg-backstage-raised relative overflow-hidden',
        'after:animate-skeleton-sweep after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent,rgb(255_226_176/0.06),transparent)]',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
