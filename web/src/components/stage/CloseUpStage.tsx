'use client';

import dynamic from 'next/dynamic';
import { useReducedMotion } from 'motion/react';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';

import type { EyeFocus } from '@/components/landing/eye/EyeMacro';
import { cn } from '@/lib/utils';

import { Viewfinder } from './Viewfinder';

const EyeMacro = dynamic(() => import('@/components/landing/eye/EyeMacro'), {
  ssr: false,
  loading: () => null,
});

interface CloseUpStageProps {
  /**
   * Live close-up content (e.g. the character's face camera). Replaces the
   * procedural eye poster when provided.
   */
  children?: ReactNode;
  label: string;
  /** Which realism layer is being read, so the poster can respond (pupil, light). */
  focus: EyeFocus;
  className?: string;
}

/** Falls back to the CSS poster if WebGL is unavailable or the scene throws. */
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Static stand-in while the 3D eye loads (or when it cannot run). */
function EyePosterFallback({ hidden }: { hidden: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'absolute inset-0 grid place-items-center transition-opacity duration-700',
        hidden && 'opacity-0',
      )}
    >
      <div className="relative aspect-square w-[46%] rounded-full bg-[radial-gradient(circle,#070606_0_15%,#4a3a22_17%,#6c7650_34%,#46564f_44%,#2e2822_50%,#c9c0b4_53%,#a59a8e_72%,transparent_76%)] opacity-80" />
    </div>
  );
}

/**
 * The realism close-up frame: a portrait-ratio stage with a viewfinder and a
 * vignette. Mounts the 3D eye only when the frame nears the viewport and
 * renders continuously only while it is visible.
 */
export function CloseUpStage({ children, label, focus, className }: CloseUpStageProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const frame = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const hasLiveContent = children !== undefined && children !== null;

  useEffect(() => {
    const el = frame.current;
    if (!el || hasLiveContent) return undefined;
    const nearby = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setMounted(true);
          nearby.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    const inView = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      {
        threshold: 0.05,
      },
    );
    nearby.observe(el);
    inView.observe(el);
    return () => {
      nearby.disconnect();
      inView.disconnect();
    };
  }, [hasLiveContent]);

  return (
    <div
      ref={frame}
      role={hasLiveContent ? 'group' : 'img'}
      aria-label={label}
      data-stage="close-up"
      className={cn('rounded-tile bg-backstage-deep relative isolate overflow-hidden', className)}
    >
      {/* Key light falloff behind the subject. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(70%_60%_at_38%_32%,rgb(255_226_176/0.12),transparent_70%)]"
      />
      {hasLiveContent ? (
        <div data-stage-slot="" className="absolute inset-0">
          {children}
        </div>
      ) : (
        <>
          <EyePosterFallback hidden={ready} />
          {mounted ? (
            <SceneBoundary fallback={<EyePosterFallback hidden={false} />}>
              <div className="animate-lamp-on absolute inset-0">
                <EyeMacro
                  focus={focus}
                  active={visible}
                  reduceMotion={reduceMotion}
                  onReady={() => setReady(true)}
                />
              </div>
            </SceneBoundary>
          ) : null}
        </>
      )}
      {/* Vignette: the frame edges fall into darkness like a macro lens. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side,transparent_62%,rgb(11_11_10/0.92)_100%)]"
      />
      <Viewfinder />
    </div>
  );
}
