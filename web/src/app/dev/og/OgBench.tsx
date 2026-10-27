'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';

import { ParticleRenderer } from '@/features/landing/particles/renderer';
import { buildParticles } from '@/features/landing/particles/shapes';
import { loadSilhouette } from '@/features/landing/particles/silhouette';
import messages from '../../../../messages/en.json';

const WIDTH = 1200;
const HEIGHT = 630;
const VARIANTS = {
  silhouette: { stage: 5, centerX: 850, centerY: 318, scale: 200, silScale: 1.34, yaw: -0.18 },
  ring: { stage: 3, centerX: 860, centerY: 315, scale: 205, silScale: 1, yaw: 0 },
  wave: { stage: 2, centerX: 600, centerY: 470, scale: 330, silScale: 1, yaw: 0 },
  sphere: { stage: 1, centerX: 880, centerY: 315, scale: 230, silScale: 1, yaw: 0.6 },
} as const;
type Variant = keyof typeof VARIANTS;
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

function Card() {
  const params = useSearchParams();
  const key = (params.get('v') ?? 'silhouette') as Variant;
  const variant = VARIANTS[key] ?? VARIANTS.silhouette;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const story = messages.Landing.story;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = ParticleRenderer.create(canvas);
    if (!renderer) return;
    let live = true;
    void loadSilhouette().then((silhouette) => {
      if (!live) return;
      renderer.setData(buildParticles(9000, silhouette));
      renderer.resize(WIDTH, HEIGHT, 2);
      renderer.render({
        stage: variant.stage,
        time: 2.2,
        motion: 1,
        yaw: variant.yaw,
        pitch: variant.stage === 1 ? 0.25 : 0.04,
        centerX: variant.centerX,
        centerY: variant.centerY,
        scale: variant.scale,
        silScale: variant.silScale,
        facing: 1,
        gather: 0,
        lit: 7,
        pointSize: 1.7,
        count: 9000,
      });
      document.body.dataset.ready = 'true';
    });
    return () => {
      live = false;
      renderer.dispose();
    };
  }, [variant]);

  const wave = key === 'wave';
  return (
    <div
      className="bg-paper text-ink relative overflow-hidden"
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      {key === 'ring'
        ? VISEMES.map((code, i) => {
            const angle = (i / VISEMES.length) * Math.PI * 2 + 2.2 * 0.18;
            return (
              <span
                key={code}
                className="text-ink data-[lit=true]:text-cobalt absolute font-mono text-[13px] font-medium"
                data-lit={i === 7}
                style={{
                  left: variant.centerX + Math.cos(angle) * 1.33 * variant.scale,
                  top: variant.centerY + Math.sin(angle) * 1.33 * variant.scale,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {code}
              </span>
            );
          })
        : null}
      <div
        className={
          wave
            ? 'absolute inset-x-0 top-[92px] flex flex-col items-center gap-5 text-center'
            : 'absolute top-1/2 left-[72px] flex max-w-[560px] -translate-y-1/2 flex-col gap-6'
        }
      >
        <span className="text-kicker text-cobalt text-[15px]">AI Sims</span>
        <h1
          className={
            wave
              ? 'font-display max-w-[900px] text-[68px] leading-[1] font-[560] tracking-[-0.03em]'
              : 'font-display text-[64px] leading-[1] font-[560] tracking-[-0.03em]'
          }
        >
          {story.idea.title}
        </h1>
        <p className="text-ink-muted text-[22px] leading-[1.45]">{story.idea.body}</p>
      </div>
    </div>
  );
}

/** Renders one candidate at 1200×630; `?v=silhouette|ring|wave|sphere`. */
export function OgBench() {
  return (
    <Suspense>
      <Card />
    </Suspense>
  );
}
