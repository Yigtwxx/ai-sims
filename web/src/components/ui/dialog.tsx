'use client';

import * as React from 'react';
import { XIcon } from '@phosphor-icons/react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/* shadcn/ui Dialog (new-york), restyled: a raised backstage card over a dimmed stage. */
function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="bg-paper-deep/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-(--z-overlay)"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'rounded-control border-hairline bg-paper-raised data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-(--z-overlay) grid w-[min(94vw,880px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-hidden border p-5 shadow-[0_18px_40px_rgb(23_26_33/0.12)] duration-200',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="rounded-control text-ink-muted hover:bg-paper-lift hover:text-ink absolute top-3 right-3 inline-flex size-10 items-center justify-center transition-colors duration-200"
          aria-label={closeLabel}
        >
          <XIcon className="size-5" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-title text-ink', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-label text-ink-muted', className)}
      {...props}
    />
  );
}

export { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription };
