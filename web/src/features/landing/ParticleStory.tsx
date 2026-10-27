'use client';

import { ArrowRightIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type CSSProperties } from 'react';

import { EnterForm } from '@/components/EnterForm';
import { prefersReducedMotion } from '@/components/motion/tokens';
import { cn } from '@/lib/utils';

import { layoutFor, pitchAt, pointCountFor, spinWeight } from './particles/layout';
import { ParticleRenderer } from './particles/renderer';
import { buildParticles, RING_CLUSTERS } from './particles/shapes';
import { loadSilhouette } from './particles/silhouette';
import {
  activeChapter,
  approach,
  CHAPTERS,
  chapterLook,
  chapterStage,
  LAST_STAGE,
  progressForStage,
  stageAt,
} from './particles/story';

/** Story height in small-viewport heights; the sticky stage takes one of them. */
const STORY_SCREENS = 6.5;
/** Scroll smoothing rate (per second): coarse wheel steps still morph smoothly. */
const SCROLL_RATE = 9;
const VISEMES = [
  'sil',
  'PP',
  'FF',
  'TH',
  'DD',
  'kk',
  'CH',
  'SS',
  'nn',
  'RR',
  'aa',
  'E',
  'I',
  'O',
  'U',
];
/** Ring of viseme labels, just outside the dot ring (sphere radii). */
const LABEL_RADIUS = 1.33;
const TAU = Math.PI * 2;
/** CSS px of a dot. */
const POINT_SIZE = 1.8;
/** A frame slower than this (ms) on average for ~1.5 s steps quality down. */
const SLOW_FRAME_MS = 22;
const MAX_DPR = 2;
/** Fewest points the adaptive step may leave. */
const MIN_POINTS = 2500;
/** Chest height on the normalised silhouette (the shader gathers there too). */
const CHEST = 0.42;

/** If the creator hasn't opened this long after submit (sign-in failed), the dots spread again. */
const GATHER_TIMEOUT_S = 4;

interface Runtime {
  /** Set by the CTA: hovering or focused (the silhouette turns to face the visitor). */
  facingTarget: number;
  /** Seconds since the CTA submitted, or -1: the dots gather into the chest. */
  gathering: number;
  /** Where the dots gather, in viewport px: the creator's entrance opens from here. */
  chest: { x: number; y: number };
  /** Reduced motion: no gather and no iris. */
  reduced: boolean;
}

/**
 * The landing: one tall section whose sticky stage draws thousands of ink dots
 * with WebGL2. Scrolling morphs them from scattered dust into a sphere, a sound
 * wave, the viseme ring, speaking lips and finally a human silhouette sampled
 * from a real MetaHuman. Nothing re-renders per frame: one rAF loop writes
 * uniforms and the copy's opacity straight to the DOM.
 */
export function ParticleStory() {
  const t = useTranslations('Landing.story');
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chapterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const hintRef = useRef<HTMLSpanElement>(null);
  const runtime = useRef<Runtime>({
    facingTarget: 0,
    gathering: -1,
    chest: { x: 0, y: 0 },
    reduced: false,
  });

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    if (!section || !canvas) return;
    const renderer = ParticleRenderer.create(canvas);
    if (!renderer) {
      canvas.hidden = true;
      return;
    }

    const reduced = prefersReducedMotion();
    runtime.current.reduced = reduced;
    const abort = new AbortController();
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    let dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    let count = pointCountFor(width);
    let built = 0;
    // Until (or unless) the silhouette loads, the last shape is the unit sphere.
    let silhouette: Float32Array | undefined;
    const rebuild = () => {
      // Phones and desktops share the shuffled data; only the drawn prefix differs.
      built = Math.max(count, built);
      renderer.setData(buildParticles(built, silhouette));
    };
    rebuild();
    renderer.resize(width, height, dpr);
    void loadSilhouette(abort.signal).then((points) => {
      if (abort.signal.aborted || !points) return;
      silhouette = points;
      rebuild();
    });

    // The story's scroll span, cached so a frame never forces layout.
    let top = 0;
    let span = 1;
    const measure = () => {
      const rect = section.getBoundingClientRect();
      top = rect.top + window.scrollY;
      span = Math.max(1, rect.height - window.innerHeight);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      count = Math.max(MIN_POINTS, Math.min(count, pointCountFor(width)));
      if (count > built) rebuild();
      renderer.resize(width, height, dpr);
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(section);
    resizeObserver.observe(canvas);

    const target = () => Math.min(1, Math.max(0, (window.scrollY - top) / span));
    let progress = target();
    let time = 0;
    let yaw = 0;
    let facing = 0;
    let gather = 0;
    let shownChapter = -1;
    let lastOpacity: number[] = [];
    let lastLabelOpacity = -1;

    // Adaptive quality: frames averaging slower than SLOW_FRAME_MS step down
    // the pixel ratio, then the point count. Never back up within a visit.
    let slowSum = 0;
    let slowFrames = 0;
    const adapt = (dtMs: number) => {
      slowSum += dtMs;
      slowFrames += 1;
      if (slowFrames < 90) return;
      const average = slowSum / slowFrames;
      slowSum = 0;
      slowFrames = 0;
      if (average < SLOW_FRAME_MS) return;
      if (dpr > 1) {
        dpr = Math.max(1, dpr - 0.5);
        renderer.resize(width, height, dpr);
      } else if (count > MIN_POINTS) {
        count = Math.max(MIN_POINTS, Math.round(count * 0.65));
      }
    };

    let frame = 0;
    let last = 0;
    let running = false;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dtMs = last ? Math.min(100, now - last) : 16.7;
      last = now;
      const dt = dtMs / 1000;
      if (!reduced) adapt(dtMs);

      const previous = progress;
      progress = reduced ? target() : approach(progress, target(), SCROLL_RATE, dt);
      const stage = stageAt(progress);
      if (!reduced) time += dt;

      // Spin: the sphere turns with time and scroll; flat shapes ease back to
      // facing the viewer (the nearest whole turn, so nothing unwinds).
      const spin = spinWeight(stage);
      yaw += (dt * 0.35 * (reduced ? 0 : 1) + (progress - previous) * TAU) * spin;
      if (spin < 1) {
        const home = Math.round(yaw / TAU) * TAU;
        yaw = approach(yaw, home, 3 * (1 - spin), dt);
      }
      const toSilhouette = Math.min(1, Math.max(0, stage - (LAST_STAGE - 1)));
      facing = approach(facing, runtime.current.facingTarget, 5, dt);
      const r = runtime.current;
      if (r.gathering >= 0) {
        r.gathering += dt;
        if (r.gathering > GATHER_TIMEOUT_S) r.gathering = -1;
      }
      gather = r.gathering >= 0 ? Math.min(1, gather + dt / 0.6) : approach(gather, 0, 6, dt);
      const sway = reduced ? 0 : Math.sin(time * 0.3) * 0.52;
      const bodyYaw = sway * (1 - facing);

      const layout = layoutFor(width, height, stage);
      r.chest.x = layout.centerX;
      r.chest.y = layout.centerY - CHEST * (silhouette ? layout.silScale : 1) * layout.scale;
      const lit = Math.floor(time * 2.4) % RING_CLUSTERS;
      renderer.render({
        stage,
        time,
        motion: reduced ? 0 : 1,
        yaw: yaw + bodyYaw * toSilhouette,
        pitch: pitchAt(stage) * (1 - facing * toSilhouette),
        centerX: layout.centerX,
        centerY: layout.centerY,
        scale: layout.scale,
        silScale: silhouette ? layout.silScale : 1,
        facing: facing * toSilhouette,
        gather,
        lit,
        pointSize: POINT_SIZE,
        count,
      });

      // Copy: opacity and slide per chapter, written only when it changes.
      CHAPTERS.forEach((_, i) => {
        const el = chapterRefs.current[i];
        if (!el) return;
        const look = chapterLook(i, stage);
        const opacity = Math.round(look.opacity * 1000) / 1000;
        if (lastOpacity[i] === opacity && opacity === 0) return;
        lastOpacity[i] = opacity;
        el.style.opacity = String(opacity);
        el.style.transform = `translate3d(0, ${look.offset.toFixed(1)}px, 0)`;
        el.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none';
      });
      const active = activeChapter(stage);
      if (active !== shownChapter) {
        shownChapter = active;
        stepRefs.current.forEach((el, i) => {
          if (!el) return;
          el.dataset.active = String(i === active);
          if (i === active) el.setAttribute('aria-current', 'step');
          else el.removeAttribute('aria-current');
        });
      }
      if (hintRef.current) hintRef.current.style.opacity = String(Math.max(0, 1 - progress * 20));

      // Viseme labels ride the same rotation as the ring.
      const ringOpacity = Math.max(0, 1 - Math.abs(stage - 3) * 2.4);
      if (ringOpacity > 0 || lastLabelOpacity !== 0) {
        lastLabelOpacity = ringOpacity;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const pitch = pitchAt(stage);
        const cx = Math.cos(pitch);
        const sx = Math.sin(pitch);
        labelRefs.current.forEach((el, i) => {
          if (!el) return;
          const angle = (i / VISEMES.length) * TAU + time * 0.18;
          const x = Math.cos(angle) * LABEL_RADIUS;
          const y = Math.sin(angle) * LABEL_RADIUS;
          const x1 = x * cy;
          const z1 = -x * sy;
          const y1 = y * cx - z1 * sx;
          const z2 = y * sx + z1 * cx;
          const persp = 3.2 / (3.2 + z2);
          const px = layout.centerX + x1 * layout.scale * persp;
          const py = layout.centerY + y1 * layout.scale * persp;
          el.style.opacity = String(ringOpacity * (i === lit ? 1 : 0.55));
          el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
          el.dataset.lit = String(i === lit);
        });
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };
    // Draw only while the story is on screen and the tab is visible.
    let onScreen = true;
    const sync = () => (onScreen && document.visibilityState === 'visible' ? start() : stop());
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      sync();
    });
    visibility.observe(section);
    document.addEventListener('visibilitychange', sync);
    lastOpacity = [];
    start();

    return () => {
      abort.abort();
      stop();
      // Leave the entrance flag up while the creator's view transition plays.
      window.setTimeout(() => delete document.documentElement.dataset.arrive, 1200);
      visibility.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', sync);
      renderer.dispose();
    };
  }, []);

  /** Jump to a chapter (step list, or keyboard focus landing in a faded one). */
  const scrollToChapter = (chapter: number, behavior: ScrollBehavior = 'smooth') => {
    const section = sectionRef.current;
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const span = rect.height - window.innerHeight;
    const progress = progressForStage(chapter === 0 ? 0 : chapterStage(chapter));
    window.scrollTo({ top: rect.top + window.scrollY + span * progress, behavior });
  };

  const face = (on: boolean) => {
    runtime.current.facingTarget = on ? 1 : 0;
  };

  return (
    <section
      ref={sectionRef}
      aria-label={t('label')}
      data-header-clear=""
      data-hide-footer=""
      className="relative"
      style={{ height: `${STORY_SCREENS * 100}svh` }}
    >
      <div className="sticky top-0 h-svh overflow-hidden">
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 block size-full" />

        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {VISEMES.map((code, i) => (
            <span
              key={code}
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className="text-ink data-[lit=true]:text-cobalt absolute top-0 left-0 font-mono text-[12px] font-medium opacity-0 will-change-transform"
            >
              {code}
            </span>
          ))}
        </div>

        {CHAPTERS.map((chapter, i) => {
          const Title = i === 0 ? 'h1' : 'h2';
          const last = i === CHAPTERS.length - 1;
          return (
            <div
              key={chapter}
              ref={(el) => {
                chapterRefs.current[i] = el;
              }}
              onFocusCapture={() => scrollToChapter(i, 'auto')}
              // On the header's gutter, also past 1440px where the header centres.
              className="absolute bottom-[clamp(3.5rem,11svh,6rem)] left-5 flex max-w-[min(540px,calc(100vw-2.5rem))] flex-col gap-4 will-change-[opacity,transform] md:left-8 lg:left-[max(3rem,calc((100%-1440px)/2+3rem))]"
              style={{ opacity: i === 0 ? 1 : 0 } satisfies CSSProperties}
            >
              {/* The first kicker is the brand: no Turkish dotted İ in "AI Sims". */}
              <span className="text-kicker text-cobalt" lang={i === 0 ? 'en' : undefined}>
                {t(`${chapter}.kicker`)}
              </span>
              <Title className="font-display text-ink text-[clamp(2.5rem,4.4vw,4.25rem)] leading-[1] font-[560] tracking-[-0.03em]">
                {t(`${chapter}.title`)}
              </Title>
              <p className="text-ink-muted max-w-[30em] text-[17px] leading-[1.55] md:text-[18px]">
                {t(`${chapter}.body`)}
              </p>
              {last ? (
                <div
                  className="mt-2 self-start"
                  onPointerEnter={() => face(true)}
                  onPointerLeave={() => face(false)}
                  onFocus={() => face(true)}
                  onBlur={() => face(false)}
                  onSubmit={() => {
                    const r = runtime.current;
                    if (r.reduced) return;
                    r.gathering = 0;
                    // The creator opens as a circle from where the dots gather (globals.css).
                    const root = document.documentElement;
                    root.style.setProperty('--arrive-x', `${Math.round(r.chest.x)}px`);
                    root.style.setProperty('--arrive-y', `${Math.round(r.chest.y)}px`);
                    root.dataset.arrive = 'gather';
                  }}
                >
                  <EnterForm
                    next="/create"
                    variant="primary"
                    size="lg"
                    inlineError
                    className="group/cta h-[3.75rem] gap-3 px-7 text-[17px]"
                  >
                    {t('start.cta')}
                    <ArrowRightIcon
                      aria-hidden="true"
                      weight="bold"
                      className="ease-out-expo size-[18px] transition-transform duration-300 group-hover/cta:translate-x-1"
                    />
                  </EnterForm>
                </div>
              ) : null}
            </div>
          );
        })}

        <nav
          aria-label={t('steps.label')}
          className="absolute top-1/2 right-8 hidden -translate-y-1/2 md:block lg:right-[max(3rem,calc((100%-1440px)/2+3rem))]"
        >
          <ol className="flex flex-col items-end gap-1">
            {CHAPTERS.map((chapter, i) => (
              <li key={chapter}>
                <button
                  type="button"
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  data-active={i === 0}
                  aria-current={i === 0 ? 'step' : undefined}
                  onClick={() => scrollToChapter(i)}
                  className={cn(
                    'group/step text-kicker text-ink-faint hover:text-ink flex h-8 items-center gap-2.5 transition-colors duration-200',
                    'data-[active=true]:text-ink',
                  )}
                >
                  {t(`steps.${chapter}`)}
                  <span
                    aria-hidden="true"
                    className="ease-out-expo h-0.5 w-3 bg-current transition-[width] duration-500 group-data-[active=true]/step:w-7"
                  />
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <span
          ref={hintRef}
          aria-hidden="true"
          className="text-kicker text-ink-faint absolute bottom-7 left-1/2 hidden -translate-x-1/2 md:block"
        >
          {t('scrollHint')}
        </span>
      </div>
    </section>
  );
}
