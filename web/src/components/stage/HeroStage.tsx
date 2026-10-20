import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { StagePoster } from './StagePoster';

export interface HeroStageProps {
  /**
   * Live content for the stage, typically the 3D character canvas. It fills
   * the stage and sits above the poster light. Frame the character at
   * `--stage-x` (64% of the width on desktop, centred below 768px) with its
   * feet on `--stage-floor`.
   */
  children?: ReactNode;
  /** Accessible description of what the stage shows. */
  label: string;
  /**
   * Keep the CSS poster lighting behind the children (default). Pass false
   * when the 3D scene renders its own studio backdrop.
   */
  posterBehind?: boolean;
  className?: string;
}

/**
 * The hero stage slot. Until a live character is mounted it shows the lit,
 * empty stage poster; never a fake person. The component is the boundary the
 * main session mounts the 3D character into.
 */
export function HeroStage({ children, label, posterBehind = true, className }: HeroStageProps) {
  const hasLiveContent = children !== undefined && children !== null;

  return (
    <div
      role={hasLiveContent ? 'group' : 'img'}
      aria-label={label}
      data-stage="hero"
      className={cn(
        'absolute inset-0 overflow-hidden [--stage-floor:44%] [--stage-x:50%] md:[--stage-floor:82%] md:[--stage-x:64%]',
        className,
      )}
    >
      {!hasLiveContent || posterBehind ? <StagePoster /> : null}
      {hasLiveContent ? (
        <div data-stage-slot="" className="absolute inset-0">
          {children}
        </div>
      ) : null}
    </div>
  );
}
