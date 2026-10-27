import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/*
 * shadcn/ui Button (new-york), restyled for "Paper and Ink": an ink pill
 * primary, quiet outlined pills, ghost text buttons. A press sinks to 0.97 in
 * 100 ms and springs back in 200 ms (Tailwind's `scale` is its own CSS
 * property, so it must be listed in the transition to animate at all).
 * A disabled primary turns to an outlined pill instead of half-transparent ink,
 * except while busy: a pressed button that is working keeps its fill.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[background-color,color,border-color,box-shadow,scale] duration-200 ease-out-quint outline-none select-none active:scale-[0.97] active:duration-100 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-ink/85 disabled:bg-transparent disabled:text-ink-faint disabled:opacity-100 disabled:shadow-[inset_0_0_0_1px_var(--color-input)] aria-busy:bg-ink aria-busy:text-paper aria-busy:shadow-none',
        quiet:
          'border border-ink/25 bg-transparent text-ink hover:border-ink/60 hover:bg-ink/[0.04]',
        ghost: 'text-ink-muted hover:bg-ink/[0.05] hover:text-ink',
        link: 'h-auto px-0 text-ink-muted underline-offset-4 hover:text-ink hover:underline',
      },
      size: {
        sm: 'h-9 px-3.5 text-label',
        default: 'h-10 px-4 text-sm',
        lg: 'h-13 px-6 text-body-sm',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'quiet',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'quiet'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
