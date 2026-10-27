import { cn } from '@/lib/utils';

/*
 * shadcn/ui Skeleton, restyled: a raised block with a slow paper-white light
 * sweep instead of a pulse (frozen under reduced motion by the global rule).
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'rounded-tile bg-paper-raised relative overflow-hidden',
        'after:animate-skeleton-sweep after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.45),transparent)]',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
