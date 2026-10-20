'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MhStage } from '@/features/avatar/mh/MhStage';
import { SpeechPlayer } from '@/features/lipsync/speechPlayer';
import { MhManifestSchema, type MhManifest } from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';

import { benchIris, benchSkin } from '../benchSkins';

const FACES = ['Ada', 'Aera', 'Aoi'] as const;
/**
 * Retargeted crowd idles (web/scripts/retarget-fbx.mjs output) that its
 * clips.json flags `standing` with an upright torso; used as the body layer.
 */
const CROWD_IDLES = [20, 29, 34, 36, 38, 41, 49, 57].map((n) => ({
  id: `crowd${n}`,
  kind: 'body' as const,
  file: `animations/fab/crowd_idle_59/Crowd_Idle_UE5_Smooth${String(n).padStart(3, '0')}.glb`,
  tags: ['idle', 'standing'],
}));
/** The calm HumanIK stand loop, listed three times so it drives the full body (MIN_CALM_IDLES). */
const STAND_IDLES = [1, 2, 3].map((n) => ({
  id: `stand${n}`,
  kind: 'body' as const,
  file: 'animations/fab/standing_idle_npc/24shibuya_stand3_youngman_loop_hik_60fps.glb',
  tags: ['idle', 'standing', 'calm'],
}));
const IDLE_SETS = { crowd: CROWD_IDLES, stand: STAND_IDLES } as const;
type IdleSet = keyof typeof IDLE_SETS;

/**
 * Minimal manifest over the converted files on this machine, until the
 * converter writes the real manifest.json. Dev only.
 */
function benchManifest(idles: IdleSet): MhManifest {
  const body = (gender: 'female' | 'male') => ({
    gender,
    glb: `bodies/${gender}/body.glb`,
    sliders: [{ id: 'height', min: -1, max: 1, default: 0 }],
    presets: {},
  });
  return MhManifestSchema.parse({
    version: 2,
    generatedAt: 'dev',
    faces: FACES.map((id) => ({
      id,
      label: id,
      gender: 'female',
      head: `faces/${id}/head.glb`,
      defaultSkin: id,
    })),
    skins: FACES.map(benchSkin),
    irises: FACES.map(benchIris),
    animations: IDLE_SETS[idles],
    bodies: [body('female'), body('male')],
  });
}

/** MhStage in talk or creator mode with the Turkish sample, for checking life and lip-sync. */
export function DevStageViewer() {
  const [idles, setIdles] = useState<IdleSet>('crowd');
  const manifest = useMemo(() => benchManifest(idles), [idles]);
  const [face, setFace] = useState<(typeof FACES)[number]>('Ada');
  const [mode, setMode] = useState<'talk' | 'creator'>('talk');
  const [thinking, setThinking] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [speech, setSpeech] = useState<SpeechPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const player = useRef<SpeechPlayer | null>(null);

  const config = useMemo(() => {
    const value = createDefaultConfig('female');
    value.face.preset = face;
    return value;
  }, [face]);

  const speak = useCallback(async () => {
    await player.current?.dispose();
    const [audio, text] = await Promise.all([
      fetch('/assets/samples/tr-greeting.wav').then((r) => r.arrayBuffer()),
      fetch('/assets/samples/tr-greeting.txt').then((r) => r.text()),
    ]);
    const next = new SpeechPlayer();
    await next.load(audio, { text });
    player.current = next;
    setSpeech(next);
    await next.play(() => setSpeech(null));
  }, []);

  useEffect(
    () => () => {
      void player.current?.dispose();
    },
    [],
  );

  return (
    <div className="relative h-full w-full">
      <MhStage
        config={config}
        manifest={manifest}
        mode={mode}
        zoom={zoom}
        onZoomChange={setZoom}
        speech={speech}
        thinking={thinking}
        insetRight={mode === 'talk' ? 420 : 0}
        onReady={() => setReady(true)}
        className="absolute inset-0"
      />
      <aside className="bg-backstage/90 absolute top-3 right-3 flex w-[396px] flex-col gap-2 rounded-lg p-3 text-xs">
        <span data-testid="ready">{ready ? 'ready' : 'loading'}</span>
        <label className="flex gap-2">
          face
          <select value={face} onChange={(e) => setFace(e.target.value as (typeof FACES)[number])}>
            {FACES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          mode
          <select value={mode} onChange={(e) => setMode(e.target.value as 'talk' | 'creator')}>
            <option>talk</option>
            <option>creator</option>
          </select>
          idles
          <select value={idles} onChange={(e) => setIdles(e.target.value as IdleSet)}>
            {Object.keys(IDLE_SETS).map((key) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          zoom
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          {zoom.toFixed(2)}
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={thinking}
            onChange={(e) => setThinking(e.target.checked)}
          />
          thinking
        </label>
        <button
          type="button"
          onClick={speak}
          disabled={speech !== null}
          className="rounded bg-amber-400 px-2 py-1 text-black"
        >
          {speech ? 'speaking…' : 'speak tr sample'}
        </button>
      </aside>
    </div>
  );
}
