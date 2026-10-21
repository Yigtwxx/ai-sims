'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/* shadcn/ui Switch (new-york), restyled: graphite track that turns amber when on. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer border-hairline bg-backstage-lift data-[state=checked]:border-marquee data-[state=checked]:bg-marquee inline-flex h-6 w-10 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-200 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-ink ease-out-quint data-[state=checked]:bg-backstage pointer-events-none block size-[18px] rounded-full shadow-[0_1px_3px_rgb(5_5_4/0.5)] transition-transform duration-200 data-[state=checked]:translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
