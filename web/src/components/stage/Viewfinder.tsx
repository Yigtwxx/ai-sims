'use client';

import { animate, cubicBezier, stagger, svg, utils, type JSAnimation } from 'animejs';
import { useEffect, useRef } from 'react';

import { EASE, ms, DURATION, prefersReducedMotion } from '@/components/motion/tokens';

/**
 * Camera viewfinder over the close-up: crop corners draw themselves in, then
 * the focus brackets close in on the subject, like autofocus locking.
 * Lines are visible by default; anime.js only animates them when the frame
 * scrolls into view and motion is allowed.
 */
export function Viewfinder() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return undefined;

    const lines = svg.createDrawable(el.querySelectorAll('[data-vf-line]'));
    const brackets = el.querySelector('[data-vf-focus]');
    utils.set(lines, { draw: '0 0' });
    if (brackets instanceof HTMLElement || brackets instanceof SVGElement) {
      brackets.style.opacity = '0';
    }

    const running: JSAnimation[] = [];
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        running.push(
          animate(lines, {
            draw: ['0 0', '0 1'],
            duration: ms(DURATION.cinematic),
            delay: stagger(90),
            ease: cubicBezier(...EASE.outExpo),
          }),
        );
        if (brackets) {
          running.push(
            animate(brackets, {
              opacity: [0, 1],
              scale: [1.28, 1],
              duration: ms(0.9),
              delay: ms(0.75),
              ease: cubicBezier(...EASE.outQuint),
            }),
          );
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      running.forEach((animation) => animation.revert());
    };
  }, []);

  const corner = 'absolute size-7 text-ink/45 md:size-9';

  return (
    <div ref={root} aria-hidden="true" className="pointer-events-none absolute inset-4 md:inset-6">
      <svg className={`${corner} top-0 left-0`} viewBox="0 0 36 36" fill="none">
        <path data-vf-line d="M1 35 V1 H35" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg className={`${corner} top-0 right-0`} viewBox="0 0 36 36" fill="none">
        <path data-vf-line d="M1 1 H35 V35" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg className={`${corner} right-0 bottom-0`} viewBox="0 0 36 36" fill="none">
        <path data-vf-line d="M35 1 V35 H1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg className={`${corner} bottom-0 left-0`} viewBox="0 0 36 36" fill="none">
        <path data-vf-line d="M35 35 H1 V1" stroke="currentColor" strokeWidth="1.5" />
      </svg>

      <svg
        data-vf-focus
        className="text-marquee/80 absolute top-1/2 left-1/2 size-[38%] max-h-64 max-w-64 -translate-x-1/2 -translate-y-1/2"
        viewBox="0 0 100 100"
        fill="none"
      >
        <path
          d="M2 18 V2 H18"
          stroke="currentColor"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M82 2 H98 V18"
          stroke="currentColor"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M98 82 V98 H82"
          stroke="currentColor"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M18 98 H2 V82"
          stroke="currentColor"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
