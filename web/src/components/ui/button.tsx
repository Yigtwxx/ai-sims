import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/*
 * shadcn/ui Button (new-york), restyled for "The Lit Stage": one marquee-amber
 * primary, quiet raised controls, 12px control radius, press scales to 0.98.
 * A disabled primary goes dark instead of half-transparent amber (the lamp is
 * off), except while busy: a pressed button that is working keeps its light.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap transition-[background-color,color,border-color,transform] duration-200 ease-out-quint outline-none select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-marquee-deep disabled:bg-backstage-raised disabled:text-ink-faint disabled:opacity-100 disabled:shadow-[inset_0_0_0_1px_var(--color-hairline)] aria-busy:bg-marquee aria-busy:text-backstage aria-busy:shadow-none',
        quiet:
          'border border-hairline bg-backstage-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] hover:bg-backstage-lift',
        ghost: 'text-ink-muted hover:bg-backstage-raised hover:text-ink',
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
