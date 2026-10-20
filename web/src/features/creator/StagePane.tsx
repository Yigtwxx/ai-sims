'use client';

import { useProgress } from '@react-three/drei';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import type { CameraFocus } from '../avatar/cameraFocus';
import { Stage } from '../avatar/Stage';
import { VrmAvatar } from '../avatar/VrmAvatar';
import type { SpeechPlayer } from '../lipsync/speechPlayer';
import type { AvatarProps } from './avatarProps';
import { BackdropName } from './BackdropName';
import { RotateIcon } from './ui/icons';

interface StagePaneProps {
  avatar?: AvatarProps;
  focus: CameraFocus;
  /** Pixels covered by the wall panel; overlays and the subject centre in the rest. */
  insetLeft: number;
  name: string;
  locale: string;
  /** Category name shown as a title card when the camera moves. */
  titleCard?: string;
  labels: { dragHint: string; loading: string };
  speech?: SpeechPlayer;
  /** Show the one-time drag hint (hidden during the premiere). */
  showHint?: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

/** The premiere stage: full-bleed canvas with overlays aligned to the visible area. */
export function StagePane({
  avatar,
  focus,
  insetLeft,
  name,
  locale,
  titleCard,
  labels,
  speech,
  showHint = true,
  onCanvasReady,
}: StagePaneProps) {
  const [height, setHeight] = useState<number>();
  const container = useRef<HTMLDivElement>(null);

  return (
    <div ref={container} className="absolute inset-0">
      <Stage
        backdrop="dark"
        look="anime"
        focus={focus}
        insetLeft={insetLeft}
        subjectHeight={height}
        className="absolute inset-0"
        onCreated={() => {
          const canvas = container.current?.querySelector('canvas');
          if (canvas) onCanvasReady?.(canvas);
        }}
        scenery={<BackdropName name={name} height={height} locale={locale} />}
      >
        {avatar && <VrmAvatar {...avatar} speech={speech} onMeasured={setHeight} />}
      </Stage>

      <div
        className="ease-out-expo pointer-events-none absolute inset-y-0 right-0 transition-[left] duration-700"
        style={{ left: insetLeft }}
      >
        <TitleCard text={titleCard} />
        <StageLoader label={labels.loading} />
        {showHint && <DragHint label={labels.dragHint} container={container} />}
      </div>
    </div>
  );
}

function TitleCard({ text }: { text?: string }) {
  return (
    <div className="absolute top-9 left-10">
      <AnimatePresence mode="wait">
        {text && (
          <motion.div
            key={text}
            initial={{ opacity: 0, y: 14, clipPath: 'inset(0 0 100% 0)' }}
            animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)' }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-display text-ink/90 text-[2.6rem] leading-none">{text}</p>
            <motion.span
              className="bg-marquee mt-3 block h-[3px] w-8 origin-left rounded-full"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.18, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Thin marquee progress line while models stream in. */
function StageLoader({ label }: { label: string }) {
  const { active, progress } = useProgress();
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6 } }}
          className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <span className="text-ink-muted text-[13px] font-medium">{label}</span>
          <span className="bg-hairline relative h-[2px] w-48 overflow-hidden rounded-full">
            <span
              className="bg-marquee ease-out-expo absolute inset-y-0 left-0 transition-[width] duration-300"
              style={{ width: `${Math.max(6, progress)}%` }}
            />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Shown until the first drag on the stage, then retires for the session. */
function DragHint({
  label,
  container,
}: {
  label: string;
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const hide = () => setVisible(false);
    el.addEventListener('pointerdown', hide, { once: true });
    return () => el.removeEventListener('pointerdown', hide);
  }, [container]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 1.2, duration: 0.6 } }}
          exit={{ opacity: 0, y: 8 }}
          className="bg-backstage/70 text-ink-muted absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-[13px] ring-1 ring-white/10"
        >
          <motion.span
            animate={{ rotate: [0, -18, 18, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.2 }}
          >
            <RotateIcon width={18} height={18} />
          </motion.span>
          {label}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
