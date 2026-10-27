'use client';

import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { Component, type ReactNode } from 'react';

import { StagePoster } from '@/components/stage/StagePoster';
import { Button } from '@/components/ui/button';

interface StageBoundaryProps {
  /** What to show instead of the stage; `retry` mounts the stage again. */
  fallback: (retry: () => void) => ReactNode;
  children: ReactNode;
}

/**
 * Keeps a 3D stage failure (a broken asset, a lost WebGL context) inside the
 * stage, so the panels around it stay usable instead of the route error page.
 */
export class StageBoundary extends Component<StageBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

/** The lit, empty stage with a short note and a retry, centred in the uncovered area. */
export function StageFailed({
  retry,
  insetLeft = 0,
  insetRight = 0,
}: {
  retry: () => void;
  insetLeft?: number;
  insetRight?: number;
}) {
  const t = useTranslations('Status');
  return (
    <div
      className="absolute inset-0 [--stage-floor:82%] [--stage-x:calc(50%+(var(--inset-l)-var(--inset-r))/2)]"
      style={{
        ['--inset-l' as string]: `${insetLeft}px`,
        ['--inset-r' as string]: `${insetRight}px`,
      }}
    >
      <StagePoster />
      <div
        role="alert"
        className="absolute inset-y-0 flex items-center justify-center px-6"
        style={{ left: insetLeft, right: insetRight }}
      >
        <div className="rounded-control border-hairline bg-paper-raised flex max-w-sm flex-col items-center gap-4 border px-6 py-5 text-center">
          <p className="text-body-sm text-ink-muted">{t('stageFailed')}</p>
          <Button type="button" variant="quiet" size="sm" onClick={retry}>
            <ArrowClockwiseIcon aria-hidden="true" />
            {t('retry')}
          </Button>
        </div>
      </div>
    </div>
  );
}
