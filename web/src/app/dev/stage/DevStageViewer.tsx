'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MhStage } from '@/features/avatar/mh/MhStage';
import { SpeechPlayer } from '@/features/lipsync/speechPlayer';
import {
  MANIFEST_URL,
  MhManifestSchema,
  type GroomSlot,
  type MhManifest,
} from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';
import { HAIR_PATTERNS, type HairPattern } from '@/lib/character/schema';

/**
 * Retargeted crowd idles (web/scripts/retarget-fbx.mjs output) that its
 * clips.json flags `standing` with an upright torso; used as the body layer.
 */
const CROWD_IDLES = [20, 29, 34, 36, 38, 41, 49, 57].map((n) => ({
  id: `crowd${n}`,
  kind: 'body' as const,
  file: `animations/fab/crowd_idle_59/Crowd_Idle_UE5_Smooth${String(n).padStart(3, '0')}.glb`,
  loop: true,
  tags: ['idle', 'standing'],
}));
/** The calm HumanIK stand loop, listed three times so it drives the full body (MIN_CALM_IDLES). */
const STAND_IDLES = [1, 2, 3].map((n) => ({
  id: `stand${n}`,
  kind: 'body' as const,
  file: 'animations/fab/standing_idle_npc/24shibuya_stand3_youngman_loop_hik_60fps.glb',
  loop: true,
  tags: ['idle', 'standing', 'calm'],
}));
const IDLE_SETS = { manifest: null, crowd: CROWD_IDLES, stand: STAND_IDLES } as const;
type IdleSet = keyof typeof IDLE_SETS;
const FACIAL: GroomSlot[] = ['eyebrows', 'beard', 'mustache'];
type Styles = Record<'hair' | 'eyebrows' | 'beard' | 'mustache', string>;

function useManifest(): MhManifest | null {
  const [manifest, setManifest] = useState<MhManifest | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(MANIFEST_URL)
      .then((response) => response.json())
      .then((json: unknown) => {
        if (live) setManifest(MhManifestSchema.parse(json));
      });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

/** MhStage over the converted manifest, for checking life, lip-sync and grooms. Dev only. */
export function DevStageViewer() {
  const loaded = useManifest();
  const [idles, setIdles] = useState<IdleSet>('manifest');
  const manifest = useMemo(() => {
    const override = loaded && IDLE_SETS[idles];
    return loaded && override ? { ...loaded, animations: [...override] } : loaded;
  }, [loaded, idles]);
  const [face, setFace] = useState('face.Ada');
  const [styles, setStyles] = useState<Styles>({
    hair: 'groom.hair.Hair_M_BobCurly',
    eyebrows: 'groom.eyebrows.Eyebrows_M_Fine',
    beard: '',
    mustache: '',
  });
  const [melanin, setMelanin] = useState(0.5);
  const [redness, setRedness] = useState(0.3);
  const [pattern, setPattern] = useState<HairPattern>('none');
  const [mode, setMode] = useState<'talk' | 'creator'>('talk');
  const [thinking, setThinking] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [speech, setSpeech] = useState<SpeechPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const player = useRef<SpeechPlayer | null>(null);

  const config = useMemo(() => {
    const gender = manifest?.faces.find((f) => f.id === face)?.gender ?? 'female';
    const value = createDefaultConfig(gender);
    value.face.preset = face;
    value.hair.style = styles.hair || null;
    value.hair.color = { melanin, redness, dye: null };
    value.hair.pattern = { type: pattern, color: '#e8c48a', amount: 0.6 };
    value.eyebrows.style = styles.eyebrows || null;
    value.beard.style = styles.beard || null;
    value.mustache.style = styles.mustache || null;
    return value;
  }, [manifest, face, styles, melanin, redness, pattern]);

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

  if (!manifest) return <p className="p-4 text-xs">loading manifest…</p>;
  const groomsOf = (slot: GroomSlot) => manifest.grooms.filter((g) => g.slot === slot);

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
          <select value={face} onChange={(e) => setFace(e.target.value)}>
            {manifest.faces.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id} ({f.gender})
              </option>
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
        {(['hair', ...FACIAL] as const).map((slot) => (
          <label key={slot} className="flex gap-2">
            {slot}
            <select
              data-testid={`groom-${slot}`}
              value={styles[slot as keyof Styles]}
              onChange={(e) => setStyles((s) => ({ ...s, [slot]: e.target.value }))}
            >
              <option value="">none</option>
              {groomsOf(slot).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id.replace(`groom.${slot}.`, '')}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex items-center gap-2">
          melanin
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={melanin}
            onChange={(e) => setMelanin(Number(e.target.value))}
          />
          {melanin.toFixed(2)} redness
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={redness}
            onChange={(e) => setRedness(Number(e.target.value))}
          />
          {redness.toFixed(2)}
        </label>
        <label className="flex gap-2">
          pattern
          <select value={pattern} onChange={(e) => setPattern(e.target.value as HairPattern)}>
            {HAIR_PATTERNS.map((p) => (
              <option key={p}>{p}</option>
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
