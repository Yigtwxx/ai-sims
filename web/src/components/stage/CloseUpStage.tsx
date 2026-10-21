import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Viewfinder } from './Viewfinder';

interface CloseUpStageProps {
  /** The close-up itself: a render of the character's face, or its live face camera. */
  children: ReactNode;
  label: string;
  className?: string;
}

/**
 * The realism close-up frame: a stage with a viewfinder and a vignette, so
 * the frame edges fall into darkness like a macro lens.
 */
export function CloseUpStage({ children, label, className }: CloseUpStageProps) {
  return (
    <div
      role="img"
      aria-label={label}
      data-stage="close-up"
      className={cn('rounded-tile bg-backstage-deep relative isolate overflow-hidden', className)}
    >
      <div data-stage-slot="" className="absolute inset-0">
        {children}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side,transparent_62%,rgb(11_11_10/0.92)_100%)]"
      />
      <Viewfinder />
    </div>
  );
}
