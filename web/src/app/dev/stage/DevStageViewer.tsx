'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MhStage } from '@/features/avatar/mh/MhStage';
import type { QualityPreference } from '@/features/avatar/quality';
import { fetchSpeechClip, speechScript, type SpeechScript } from '@/features/chat/ttsClient';
import { EYE_TINTS } from '@/features/creator/palettes';
import { outfitsFor } from '@/features/creator/reconcile';
import { SpeechPlayer } from '@/features/lipsync/speechPlayer';
import {
  labelFor,
  MANIFEST_URL,
  MhManifestSchema,
  OUTFIT_CATEGORIES,
  type GroomSlot,
  type MhManifest,
  type OutfitCategory,
} from '@/lib/assets/manifest';
import { createDefaultConfig } from '@/lib/character/defaults';
import {
  BODY_SLIDERS,
  HAIR_PATTERNS,
  type BodySlider,
  type CharacterConfig,
  type HairPattern,
  type OutfitItem,
} from '@/lib/character/schema';

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
/** Rich in closures (m, b, p) and rounded vowels, the hardest lip-sync cases. */
const TTS_SAMPLE =
  'Merhaba, ben buradayım. Bugün müzik mi dinlemek istersin, yoksa biraz sohbet mi edelim? Pazartesi programımız çok yoğun.';
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
  const [outfit, setOutfit] = useState<CharacterConfig['outfit']>(
    () => createDefaultConfig('female').outfit,
  );
  // One slider pushed to an end ('hips:1'), for checking how garments follow the body.
  const [body, setBody] = useState('');
  const [eyeTint, setEyeTint] = useState('');
  const [blendFace, setBlendFace] = useState('');
  const [blendWeight, setBlendWeight] = useState(0.5);
  const [mode, setMode] = useState<'talk' | 'creator'>('talk');
  const [quality, setQuality] = useState<QualityPreference>('high');
  const [thinking, setThinking] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [speech, setSpeech] = useState<SpeechPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const player = useRef<SpeechPlayer | null>(null);

  const gender = manifest?.faces.find((f) => f.id === face)?.gender ?? 'female';
  const config = useMemo(() => {
    const value = createDefaultConfig(gender);
    value.face.preset = face;
    value.hair.style = styles.hair || null;
    value.hair.color = { melanin, redness, dye: null };
    value.hair.pattern = { type: pattern, color: '#e8c48a', amount: 0.6 };
    value.eyebrows.style = styles.eyebrows || null;
    value.beard.style = styles.beard || null;
    value.mustache.style = styles.mustache || null;
    value.outfit = outfit;
    value.eyes.color = eyeTint || null;
    if (blendFace) value.face.blend = { [blendFace]: blendWeight };
    if (body) {
      const [slider, end] = body.split(':');
      value.body.sliders = { [slider as BodySlider]: Number(end) };
    }
    return value;
  }, [
    gender,
    face,
    styles,
    melanin,
    redness,
    pattern,
    outfit,
    body,
    eyeTint,
    blendFace,
    blendWeight,
  ]);

  const pickOutfit = useCallback((category: OutfitCategory, id: string) => {
    setOutfit((current) => {
      const next = { ...current, [category]: id ? { id, tint: null, colors: {} } : null };
      // A one-piece outfit replaces top and bottom (see reconcileConfig).
      if (id && category === 'full') {
        next.top = null;
        next.bottom = null;
      }
      if (id && (category === 'top' || category === 'bottom')) next.full = null;
      return next;
    });
  }, []);

  const pickOutfitColor = useCallback((category: OutfitCategory, name: string, hex: string) => {
    setOutfit((current) => {
      const item = current[category];
      if (!item) return current;
      return { ...current, [category]: { ...item, colors: { ...item.colors, [name]: hex } } };
    });
  }, []);

  const play = useCallback(async (audio: ArrayBuffer, script: SpeechScript) => {
    await player.current?.dispose();
    const next = new SpeechPlayer();
    await next.load(audio, script);
    player.current = next;
    setSpeech(next);
    await next.play(() => setSpeech(null));
  }, []);

  const speak = useCallback(async () => {
    const [audio, text] = await Promise.all([
      fetch('/assets/samples/tr-greeting.wav').then((r) => r.arrayBuffer()),
      fetch('/assets/samples/tr-greeting.txt').then((r) => r.text()),
    ]);
    await play(audio, { text });
  }, [play]);

  // Real synthesis through /api/tts (needs a session; Edge TTS needs no key).
  const [ttsText, setTtsText] = useState(TTS_SAMPLE);
  const [ttsSource, setTtsSource] = useState('');
  const speakTts = useCallback(async () => {
    try {
      const clip = await fetchSpeechClip({ text: ttsText, voice: gender, locale: 'tr' });
      const script = speechScript(clip);
      setTtsSource('events' in script ? 'visemes' : 'words' in script ? 'words' : 'text');
      await play(clip.audio, script);
    } catch (error) {
      setTtsSource(`failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [gender, ttsText, play]);

  useEffect(
    () => () => {
      void player.current?.dispose();
    },
    [],
  );

  if (!manifest) return <p className="p-4 text-xs">loading manifest…</p>;
  const groomsOf = (slot: GroomSlot) => manifest.grooms.filter((g) => g.slot === slot);
  /** The colour a picker shows: the creator's pick, else the parameter's authored default. */
  const colorOf = (item: OutfitItem, name: string, fallback: unknown) =>
    item.colors[name] ?? (typeof fallback === 'string' ? fallback.toLowerCase() : '#000000');

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
        quality={quality}
        className="absolute inset-0"
      />
      <aside className="bg-paper/90 absolute top-3 right-3 flex max-h-[calc(100%-1.5rem)] w-[396px] flex-col gap-2 overflow-y-auto rounded-lg p-3 text-xs">
        <span data-testid="ready">{ready ? 'ready' : 'loading'}</span>
        <label className="flex flex-wrap gap-2">
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
          quality
          <select
            data-testid="quality"
            value={quality}
            onChange={(e) => setQuality(e.target.value as QualityPreference)}
          >
            {['auto', 'high', 'balanced', 'battery'].map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
          idles
          <select value={idles} onChange={(e) => setIdles(e.target.value as IdleSet)}>
            {Object.keys(IDLE_SETS).map((key) => (
              <option key={key}>{key}</option>
            ))}
          </select>
          blend
          <select
            data-testid="blend-face"
            value={blendFace}
            onChange={(e) => setBlendFace(e.target.value)}
          >
            <option value="">none</option>
            {manifest.faces
              .filter((f) => f.gender === gender && f.id !== face)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id}
                </option>
              ))}
          </select>
          <input
            data-testid="blend-weight"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={blendWeight}
            onChange={(e) => setBlendWeight(Number(e.target.value))}
            className="w-14"
          />
          eyes
          <select
            data-testid="eye-tint"
            value={eyeTint}
            onChange={(e) => setEyeTint(e.target.value)}
          >
            <option value="">own</option>
            {EYE_TINTS.map((tint) => (
              <option key={tint.key} value={tint.value}>
                {tint.key}
              </option>
            ))}
          </select>
          body
          <select data-testid="body" value={body} onChange={(e) => setBody(e.target.value)}>
            <option value="">neutral</option>
            {BODY_SLIDERS.flatMap((slider) =>
              [-1, 1].map((end) => (
                <option key={`${slider}:${end}`} value={`${slider}:${end}`}>
                  {slider} {end > 0 ? '+1' : '-1'}
                </option>
              )),
            )}
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
        <label className="flex flex-wrap items-center gap-2">
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
        {OUTFIT_CATEGORIES.map((category) => {
          const options = outfitsFor(manifest, category, gender);
          const item = outfit[category];
          const worn = options.find((o) => o.id === item?.id);
          const colorParams = worn?.params.filter((p) => p.type === 'color') ?? [];
          return (
            <div key={category} className="flex flex-col gap-1">
              <label className="flex gap-2">
                {category}
                <select
                  data-testid={`outfit-${category}`}
                  value={worn?.id ?? ''}
                  onChange={(e) => pickOutfit(category, e.target.value)}
                >
                  <option value="">none</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {labelFor(o.label, 'en')}
                    </option>
                  ))}
                </select>
              </label>
              {item && colorParams.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 pl-3">
                  {colorParams.map((p) => (
                    <label key={p.name} className="flex items-center gap-1">
                      {p.name}
                      <input
                        type="color"
                        data-testid={`outfit-${category}-${p.name}`}
                        value={colorOf(item, p.name, p.default)}
                        onChange={(e) => pickOutfitColor(category, p.name, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
        <textarea
          value={ttsText}
          onChange={(e) => setTtsText(e.target.value)}
          rows={3}
          className="rounded bg-black/40 p-1"
        />
        <button
          type="button"
          data-testid="speak-tts"
          onClick={speakTts}
          disabled={speech !== null}
          className="rounded bg-amber-400 px-2 py-1 text-black"
        >
          speak via /api/tts
        </button>
        <span data-testid="tts-source">{ttsSource}</span>
      </aside>
    </div>
  );
}
