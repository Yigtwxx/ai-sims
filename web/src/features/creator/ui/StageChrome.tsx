'use client';

import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useId, useRef, useState } from 'react';

import { EASE, SPRING_SOFT } from '@/components/motion/tokens';
import type { QualityPreference } from '@/features/avatar/quality';
import { cn } from '@/lib/utils';

import { CAMERA_PRESETS, type CameraPreset } from '../framing';
import { QUALITY_PREFERENCES } from '../qualityPreference';
import { portraitCrop } from '../thumbnail';

import { PressedPills } from './controls';

/**
 * What the stage chrome shows: the editing tools, the three beats of "Bitti"
 * (saving, framing the portrait, the portrait taken) and the premiere, where
 * the chrome steps aside.
 */
export type ChromeMode = 'editing' | 'saving' | 'framing' | 'captured' | 'premiere';

interface StageChromeProps {
  /** Measured panel width on desktop (0 before it is measured and on phones). */
  left: number;
  mode: ChromeMode;
  /** The framing preset the stage shows, if it shows one. */
  preset: CameraPreset | null;
  onPreset: (preset: CameraPreset) => void;
  quality: QualityPreference;
  onQuality: (quality: QualityPreference) => void;
  fixture: boolean;
  /** Changes whenever the camera reframes; the viewfinder settles again. */
  focusKey: string;
}

/** Height kept clear for the strip (desktop) or the floating controls (phones). */
const STRIP = 56;

const STATUS: Record<
  Exclude<ChromeMode, 'editing' | 'premiere'>,
  'saving' | 'framing' | 'ready'
> = {
  saving: 'saving',
  framing: 'framing',
  captured: 'ready',
};

/**
 * Everything drawn over the stage, like a camera's viewfinder: a framing and
 * quality strip along the top, crop corners around the subject and the
 * gesture hint in the lower left. On phones the strip's controls float over
 * the small stage and the corners and hint are left out while editing.
 *
 * "Bitti" turns it into the camera taking the card portrait: the strip reads
 * out the steps, the corners close in on the 3:4 crop the thumbnail uses, and
 * the shot is marked by a short paper flash. For the premiere it all lifts
 * away, the corners opening past the edges of the frame.
 */
export function StageChrome({
  left,
  mode,
  preset,
  onPreset,
  quality,
  onQuality,
  fixture,
  focusKey,
}: StageChromeProps) {
  const t = useTranslations('Creator');
  const reduceMotion = useReducedMotion() ?? false;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const editing = mode === 'editing';
  const status = mode === 'editing' || mode === 'premiere' ? null : STATUS[mode];

  return (
    <div
      ref={box}
      // Before the panel is measured, assume its CSS width on desktop.
      className="pointer-events-none absolute inset-x-0 top-0 bottom-(--creator-panel) z-10 lg:bottom-0 lg:left-[clamp(440px,32vw,500px)]"
      style={left ? { left } : undefined}
    >
      {/* The shot: a short paper flash over the stage (under the strip, which reads it out). */}
      {mode === 'captured' && !reduceMotion ? (
        <motion.div
          aria-hidden="true"
          className="bg-paper-raised absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.8, 0] }}
          transition={{ duration: 0.22, times: [0, 0.3, 1], ease: 'easeOut' }}
        />
      ) : null}

      <AnimatePresence initial={false}>
        {mode !== 'premiere' ? (
          <motion.div
            key="strip"
            role="group"
            aria-label={t('stageControls')}
            exit={{ opacity: 0, transition: { duration: 0.3, ease: EASE.outQuint } }}
            className="lg:border-hairline lg:bg-paper/90 relative flex items-center justify-between gap-2 p-3 lg:pointer-events-auto lg:h-14 lg:border-b lg:px-5 lg:py-0"
          >
            <AnimatePresence mode="wait" initial={false}>
              {editing ? (
                <motion.div
                  key="tools"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.25 } }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2"
                >
                  <PressedPills
                    label={t('camera.label')}
                    value={preset}
                    options={CAMERA_PRESETS.map((value) => ({
                      value,
                      label: t(`camera.presets.${value}`),
                    }))}
                    onChange={onPreset}
                    className="max-lg:bg-paper/90 pointer-events-auto shrink-0"
                  />
                  <div className="flex min-w-0 items-center gap-3">
                    {fixture ? (
                      <span className="border-ink/20 text-ink-faint hidden rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap uppercase xl:inline">
                        {t('manifest.fixtureBadge')}
                      </span>
                    ) : null}
                    <QualityMenu value={quality} onChange={onQuality} />
                  </div>
                </motion.div>
              ) : (
                <motion.p
                  key="status"
                  role="status"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE.outExpo } }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  className="max-lg:bg-paper/90 max-lg:border-ink/15 text-ink inline-flex h-[34px] items-center gap-2.5 font-mono text-[11px] tracking-[0.12em] uppercase max-lg:rounded-full max-lg:border max-lg:px-3.5"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full transition-colors duration-300',
                      status === 'ready' ? 'bg-ok' : 'bg-cobalt animate-pulse',
                    )}
                  />
                  {/* One beat at a time: the word swaps in place. */}
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={status}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
                      exit={{ opacity: 0, y: -3, transition: { duration: 0.12 } }}
                    >
                      {status ? t(`premiere.status.${status}`) : null}
                    </motion.span>
                  </AnimatePresence>
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <FrameCorners mode={mode} size={size} focusKey={focusKey} />

      <AnimatePresence initial={false}>
        {editing ? (
          <motion.p
            key="hint"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.3 } }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            // A paper backing: the platform under a full-body framing reaches this corner.
            className="bg-paper/85 text-ink-muted absolute bottom-4 left-[14px] hidden rounded-full px-2.5 py-1 font-mono text-[11px] tracking-[0.1em] uppercase lg:block"
          >
            {t('dragHint')}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function QualityMenu({
  value,
  onChange,
}: {
  value: QualityPreference;
  onChange: (value: QualityPreference) => void;
}) {
  const t = useTranslations('Creator.quality');
  const menuId = useId();
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className="max-lg:bg-paper/90 max-lg:border-ink/15 text-ink-muted hover:text-ink data-[state=open]:text-ink hover:bg-ink/[0.05] data-[state=open]:bg-ink/[0.06] pointer-events-auto inline-flex h-[34px] min-w-0 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] tracking-[0.1em] whitespace-nowrap uppercase transition-[background-color,color] duration-200 max-lg:border">
        {/* Phones show the value alone; the name stays for assistive tech. */}
        <span className="max-sm:sr-only">{t('label')} · </span>
        <span className="truncate">{t(`options.${value}`)}</span>
        <CaretDownIcon className="size-3 shrink-0" weight="bold" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="rounded-tile border-hairline bg-paper-raised data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-(--z-overlay) w-64 border p-1 shadow-[0_14px_36px_rgb(23_26_33/0.14)]"
        >
          <DropdownMenu.Label className="text-ink-faint px-2.5 pt-2 pb-1.5 font-mono text-[11px] tracking-[0.12em] uppercase">
            {t('label')}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const picked = QUALITY_PREFERENCES.find((option) => option === next);
              if (picked) onChange(picked);
            }}
          >
            {QUALITY_PREFERENCES.map((option) => (
              <DropdownMenu.RadioItem
                key={option}
                value={option}
                // Named by the tier; the line under it describes it.
                aria-labelledby={`${menuId}-${option}`}
                aria-describedby={`${menuId}-${option}-hint`}
                className="data-[highlighted]:bg-paper-lift flex cursor-default items-start gap-2.5 rounded-[7px] px-2.5 py-2 outline-none select-none"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span id={`${menuId}-${option}`} className="text-ui text-ink">
                    {t(`options.${option}`)}
                  </span>
                  <span id={`${menuId}-${option}-hint`} className="text-label text-ink-faint">
                    {t(`hints.${option}`)}
                  </span>
                </span>
                <DropdownMenu.ItemIndicator className="mt-0.5">
                  <CheckIcon
                    weight="bold"
                    className="text-cobalt animate-mark-in size-4"
                    aria-hidden="true"
                  />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Corner, and the direction it arrives from when the camera reframes. */
const CORNERS = [
  { id: 'tl', x: -1, y: -1, className: 'top-0 left-0 border-t border-l' },
  { id: 'tr', x: 1, y: -1, className: 'top-0 right-0 border-t border-r' },
  { id: 'br', x: 1, y: 1, className: 'right-0 bottom-0 border-r border-b' },
  { id: 'bl', x: -1, y: 1, className: 'bottom-0 left-0 border-b border-l' },
] as const;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the corners stand in each mode, in the chrome's own pixels. */
function frameFor(mode: ChromeMode, width: number, height: number): Rect {
  if (mode === 'framing' || mode === 'captured') {
    // The thumbnail's 3:4 crop of the uncovered stage, kept clear of the strip.
    const crop = portraitCrop(width, height, 0);
    const top = Math.max(crop.y, STRIP + 12);
    const bottom = Math.min(crop.y + crop.height, height - 12);
    return { left: crop.x, top, width: crop.width, height: bottom - top };
  }
  if (mode === 'premiere') {
    // Opening past the edges of the frame as they fade.
    return { left: -40, top: -40, width: width + 80, height: height + 80 };
  }
  return { left: 24, top: STRIP + 20, width: width - 48, height: height - STRIP - 20 - 56 };
}

/**
 * Crop corners around the subject. While editing, each reframing closes them
 * in from a little further out, like a focus lock (desktop only). For "Bitti"
 * they glide to the portrait crop, give a small click when the shot is taken,
 * then open out and fade for the premiere. Reduced motion moves them without
 * travel.
 */
function FrameCorners({
  mode,
  size,
  focusKey,
}: {
  mode: ChromeMode;
  size: { width: number; height: number };
  focusKey: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const editing = mode === 'editing';
  const portrait = mode === 'framing' || mode === 'captured';
  const corners = CORNERS.map((corner) => (
    <motion.span
      // Re-keyed per framing while editing only: "Bitti" moves the frame as one piece.
      key={`${corner.id}-${editing ? focusKey : 'done'}`}
      // The same first frame on the server and the client (hydration); reduced
      // motion drops the travel in the transition instead.
      initial={editing ? { opacity: 0.4, x: corner.x * 12, y: corner.y * 12 } : false}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0, opacity: { duration: 0.3 } }
          : { ...SPRING_SOFT, opacity: { duration: 0.3 } }
      }
      className={cn(
        'absolute size-[18px] transition-colors duration-500',
        portrait ? 'border-ink/75' : 'border-ink/40',
        corner.className,
      )}
    />
  ));

  // Not measured yet: the editing frame in CSS.
  if (!size.width) {
    return (
      <div
        aria-hidden="true"
        className="absolute inset-x-6 top-[4.75rem] bottom-14 hidden lg:block"
      >
        {corners}
      </div>
    );
  }

  const rect = frameFor(mode, size.width, size.height);
  return (
    <motion.div
      aria-hidden="true"
      initial={false}
      animate={{ ...rect, opacity: mode === 'premiere' ? 0 : 1 }}
      transition={
        reduceMotion
          ? { duration: 0, opacity: { duration: 0.3 } }
          : {
              duration: mode === 'premiere' ? 0.9 : 0.85,
              ease: EASE.outExpo,
              opacity: { duration: mode === 'premiere' ? 0.6 : 0.3, ease: EASE.outQuint },
            }
      }
      className={cn('absolute', editing && 'hidden lg:block')}
    >
      {/* The shutter: a small click inward when the portrait is taken. */}
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={mode === 'captured' && !reduceMotion ? { scale: [1, 0.97, 1] } : { scale: 1 }}
        transition={{ duration: 0.32, times: [0, 0.35, 1], ease: EASE.outExpo }}
      >
        {corners}
      </motion.div>
    </motion.div>
  );
}
