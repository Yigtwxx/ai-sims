'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

/** Client-side app context: Motion honours the OS reduced-motion setting; one toaster. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}
