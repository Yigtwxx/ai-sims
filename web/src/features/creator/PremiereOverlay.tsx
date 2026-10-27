'use client';

import { ArrowRightIcon } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { EASE } from '@/components/motion/tokens';
import { Button } from '@/components/ui/button';
import type { MhManifest } from '@/lib/assets/manifest';

import { premiereSpec } from './premiereSpec';
import { useCreatorStore } from './store';

interface PremiereOverlayProps {
  name: string;
  manifest: MhManifest;
  /** The card portrait taken on "Bitti" (a data URL), when the browser could take one. */
  portrait?: string;
  /** Shared layout id of the still on the stage: the card flies in from it. */
  portraitLayoutId?: string;
  onStart: () => void;
  onEdit: () => void;
}

/** Copy arrives after the panel has started to leave, one line every 120 ms. */
const FIRST = 0.35;
const STEP = 0.12;
/** The copy steps back this long before the conversation opens. */
const LEAVE_MS = 250;

/**
 * The premiere repeats the landing's last frame with the real character: it
 * stands where the dots stood (60% of the width on desktop), and the title
 * card sits in the lower left as the landing's chapters do. The portrait just
 * taken lands in the card, then the kicker, the name (rising out of a mask),
 * a one-line spec of the character and the two exits follow in turn. Reduced
 * motion keeps the fades only.
 */
export function PremiereOverlay({
  name,
  manifest,
  portrait,
  portraitLayoutId,
  onStart,
  onEdit,
}: PremiereOverlayProps) {
  const t = useTranslations('Creator.premiere');
  const locale = useLocale();
  const reduceMotion = useReducedMotion() ?? false;
  const config = useCreatorStore((state) => state.config);
  const spec = premiereSpec(config, manifest, locale);
  const specLine = [
    spec.face ? t('spec.face', { name: spec.face }) : null,
    spec.hair ? t('spec.hair', { name: spec.hair }) : null,
    spec.garments > 0 ? t('spec.outfit', { count: spec.garments }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const start = () => {
    if (leaving) return;
    setLeaving(true);
    leaveTimer.current = window.setTimeout(onStart, LEAVE_MS);
  };

  const rise = (index: number) =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { delay: FIRST + index * STEP, duration: 0.4 },
        }
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: FIRST + index * STEP, duration: 0.7, ease: EASE.outExpo },
        };

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-30"
      exit={{ opacity: 0, transition: { duration: 0.35, ease: EASE.outQuint } }}
      role="dialog"
      aria-modal="false"
      aria-label={name}
    >
      {/* Phones: the stage ends above the title card; its lower edge dissolves into paper. */}
      <motion.div
        aria-hidden="true"
        className="from-paper absolute inset-x-0 bottom-0 h-[54%] bg-gradient-to-t from-[72%] to-transparent lg:hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      />

      <motion.div
        className="pointer-events-auto absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-5 flex max-w-[min(540px,calc(100vw-2.5rem))] flex-col items-start gap-3 md:left-10 lg:bottom-[clamp(3.5rem,11svh,6rem)] lg:gap-4"
        animate={leaving ? { opacity: 0, y: reduceMotion ? 0 : 8 } : { opacity: 1, y: 0 }}
        transition={{ duration: LEAVE_MS / 1000, ease: EASE.outQuint }}
      >
        {portrait ? (
          <div className="mb-1 flex items-end gap-3.5">
            <motion.img
              layoutId={portraitLayoutId}
              src={portrait}
              alt=""
              className="border-hairline h-16 w-12 rounded-sm border object-cover lg:h-24 lg:w-[72px]"
              initial={portraitLayoutId ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={
                portraitLayoutId
                  ? { layout: { duration: 0.95, ease: EASE.outExpo } }
                  : { delay: FIRST, duration: 0.4 }
              }
            />
            <motion.p
              className="text-ink-faint pb-0.5 font-mono text-[11px] tracking-[0.12em] uppercase"
              {...rise(0)}
            >
              {t('saved')}
            </motion.p>
          </div>
        ) : null}

        <motion.p className="text-kicker text-cobalt" {...rise(1)}>
          {t('tagline')}
        </motion.p>

        <motion.h1
          className="font-display text-ink max-w-full text-[clamp(3rem,6vw,5.5rem)] leading-[0.95] tracking-[-0.03em] break-words"
          initial={
            reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, clipPath: 'inset(0 0 100% 0)' }
          }
          animate={
            reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, clipPath: 'inset(0 0 -12% 0)' }
          }
          transition={{
            delay: FIRST + 2 * STEP,
            duration: reduceMotion ? 0.4 : 0.9,
            ease: EASE.outExpo,
          }}
        >
          {name}
        </motion.h1>

        {specLine ? (
          <motion.p
            className="text-ink-muted font-mono text-[12px] leading-relaxed tracking-[0.08em] uppercase"
            {...rise(3)}
          >
            {specLine}
          </motion.p>
        ) : null}

        <motion.div
          className="mt-1 flex flex-wrap items-center gap-2.5 lg:mt-2 lg:gap-3"
          {...rise(4)}
        >
          <Button
            type="button"
            variant="primary"
            onClick={start}
            autoFocus
            className="group/start h-12 gap-2.5 pr-4 pl-5 text-[15px] lg:h-[3.25rem] lg:pr-5 lg:pl-6 lg:text-[16px]"
          >
            {t('start')}
            <ArrowRightIcon
              weight="bold"
              aria-hidden="true"
              className="ease-out-expo size-[18px] transition-transform duration-300 group-hover/start:translate-x-1"
            />
          </Button>
          <Button
            type="button"
            variant="quiet"
            onClick={onEdit}
            disabled={leaving}
            className="h-12 px-4 text-[15px] lg:h-[3.25rem] lg:px-5"
          >
            {t('edit')}
          </Button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
