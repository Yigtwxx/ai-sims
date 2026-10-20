'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CameraFocus } from '@/features/avatar/cameraFocus';
import { Stage } from '@/features/avatar/Stage';
import { VrmAvatar } from '@/features/avatar/VrmAvatar';
import type { BodyBuild } from '@/features/avatar/vrm/bodyShape';
import type { PartSelection } from '@/features/avatar/vrm/parts';
import {
  basesFor,
  loadManifest,
  partsFor,
  type Gender,
  type VrmManifest,
} from '@/features/creator/manifest';

/**
 * Development tool: renders every manifest option with the creator's own
 * stage and saves a 3:4 poster for its tile. Open /spike/bake and wait.
 */

interface Job {
  id: string;
  baseUrl: string;
  parts: PartSelection;
  focus: CameraFocus;
  build?: BodyBuild;
}

const BUILDS: BodyBuild[] = ['slim', 'average', 'athletic', 'curvy'];
const SETTLE_MS = 1400;

function buildJobs(manifest: VrmManifest): Job[] {
  const jobs: Job[] = [];
  const genders: Gender[] = ['female', 'male'];
  const defaultHair = (g: Gender) => partsFor(manifest, 'hair', g)[0]?.url;
  const defaultBase = (g: Gender) => basesFor(manifest, g)[0]?.url;
  const genderOf = (g: string): Gender => (g === 'male' ? 'male' : 'female');

  for (const base of manifest.bases) {
    jobs.push({
      id: base.id,
      baseUrl: base.url,
      parts: { hair: defaultHair(genderOf(base.gender)) },
      focus: 'face',
    });
  }
  for (const part of manifest.parts) {
    const g = genderOf(part.gender);
    const baseUrl = defaultBase(g);
    if (!baseUrl) continue;
    const focus: CameraFocus =
      part.category === 'hair'
        ? 'face'
        : part.category === 'top'
          ? 'torso'
          : part.category === 'bottom'
            ? 'legs'
            : 'feet';
    jobs.push({
      id: part.id,
      baseUrl,
      parts: { hair: defaultHair(g), [part.category]: part.url },
      focus,
    });
  }
  for (const g of genders) {
    const baseUrl = defaultBase(g);
    if (!baseUrl) continue;
    for (const build of BUILDS) {
      jobs.push({
        id: `build-${g}-${build}`,
        baseUrl,
        parts: { hair: defaultHair(g) },
        focus: 'body',
        build,
      });
    }
  }
  return jobs;
}

export function BakeScene() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [index, setIndex] = useState(0);
  const [height, setHeight] = useState<number>();
  const [log, setLog] = useState<string[]>([]);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadManifest().then((m) => setJobs(buildJobs(m)));
  }, []);

  const job = jobs[index];
  const done = jobs.length > 0 && index >= jobs.length;
  const bodyShape = useMemo(() => ({ build: job?.build ?? 'average', height: 1 }), [job]);

  const capture = useCallback(async () => {
    const canvas = container.current?.querySelector('canvas');
    if (!canvas || !job) return;
    const out = document.createElement('canvas');
    out.width = 480;
    out.height = 640;
    out.getContext('2d')?.drawImage(canvas, 0, 0, out.width, out.height);
    const dataUrl = out.toDataURL('image/webp', 0.9);
    const response = await fetch('/api/dev/thumbnails', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: job.id, dataUrl }),
    });
    setLog((l) => [...l, `${response.ok ? 'ok ' : 'ERR'} ${job.id}`]);
    setHeight(undefined);
    setIndex((i) => i + 1);
  }, [job]);

  // Capture once the model reported its height and springs/coverage settled.
  useEffect(() => {
    if (!job || height === undefined) return;
    const timer = setTimeout(() => void capture(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [job, height, capture]);

  return (
    <main className="bg-backstage text-ink flex min-h-dvh gap-8 p-8">
      <div
        ref={container}
        className="rounded-tile relative h-[640px] w-[480px] shrink-0 overflow-hidden"
      >
        {job && (
          <Stage
            key={job.id}
            backdrop="dark"
            look="anime"
            focus={job.focus}
            subjectHeight={height}
            className="absolute inset-0"
          >
            <VrmAvatar
              baseUrl={job.baseUrl}
              parts={job.parts}
              bodyShape={bodyShape}
              onMeasured={setHeight}
            />
          </Stage>
        )}
      </div>
      <div className="text-[13px]">
        <p data-testid="bake-status" className="mb-3 font-medium">
          {done ? `DONE ${jobs.length}` : `${index}/${jobs.length} ${job?.id ?? ''}`}
        </p>
        <ol className="text-ink-muted space-y-1">
          {log.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>
    </main>
  );
}
