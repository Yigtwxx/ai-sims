'use client';

import { StatsGl } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';

import { Character } from '@/features/avatar/Character';
import type { CameraFocus } from '@/features/avatar/cameraFocus';
import { Stage } from '@/features/avatar/Stage';
import { VrmAvatar } from '@/features/avatar/VrmAvatar';
import { BODY_BUILDS, type BodyBuild } from '@/features/avatar/vrm/bodyShape';
import type { PartSelection } from '@/features/avatar/vrm/parts';
import type { Tints } from '@/features/avatar/vrm/tint';
import { SpeechPlayer } from '@/features/lipsync/speechPlayer';

const SAMPLE_AUDIO = '/assets/samples/tr-greeting.wav';
const SAMPLE_TEXT = '/assets/samples/tr-greeting.txt';

const MODELS = {
  'anime: avatar-b': { look: 'anime', url: '/assets/spike/vrm/AvatarSample_B.vrm' },
  'anime: fem': { look: 'anime', url: '/assets/spike/vrm/fem_vroid.vrm' },
  'anime: masc': { look: 'anime', url: '/assets/spike/vrm/masc_vroid.vrm' },
  'real: male': { look: 'realistic', url: '/assets/spike/base_male.glb' },
  'real: female': { look: 'realistic', url: '/assets/spike/base_female.glb' },
} as const;

const FOCUSES: CameraFocus[] = ['body', 'torso', 'face', 'legs', 'feet'];

const PARTS_DIR = '/assets/vrm/parts';
const donorPart = (category: string) => `${PARTS_DIR}/AvatarSample_B__${category}.vrm`;

/** Part presets for testing donor assembly on the naked VRoid bases. */
const OUTFITS = {
  'parts: own': {},
  'parts: donor outfit': {
    top: donorPart('top'),
    bottom: donorPart('bottom'),
    shoes: donorPart('shoes'),
  },
  'parts: donor all': {
    top: donorPart('top'),
    bottom: donorPart('bottom'),
    shoes: donorPart('shoes'),
    hair: donorPart('hair'),
  },
  'parts: none': { top: null, bottom: null, shoes: null },
} satisfies Record<string, PartSelection>;

type OutfitId = keyof typeof OUTFITS;

const TINTS = {
  'tint: none': {},
  'tint: warm': { skin: '#e0b090', hair: '#c06040', top: '#ffd0d0' },
  'tint: cool': { skin: '#f0e6e0', hair: '#7090ff', eyes: '#60c0ff', bottom: '#a0c0ff' },
} satisfies Record<string, Tints>;

type TintId = keyof typeof TINTS;

type ModelId = keyof typeof MODELS;

/** Developer-only comparison bench for the realism spike (not product UI). */
export function SpikeScene() {
  const [modelId, setModelId] = useState<ModelId>('anime: avatar-b');
  const model = MODELS[modelId];
  const [measured, setMeasured] = useState<{ id: ModelId; height: number }>();
  const subjectHeight = measured?.id === modelId ? measured.height : undefined;
  const [focus, setFocus] = useState<CameraFocus>('body');
  const [outfit, setOutfit] = useState<OutfitId>('parts: own');
  const [build, setBuild] = useState<BodyBuild>('average');
  const [tint, setTint] = useState<TintId>('tint: none');
  const [sss, setSss] = useState(true);
  const [stats, setStats] = useState(false);
  const [post, setPost] = useState(true);
  const speech = useMemo(() => new SpeechPlayer(), []);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => void speech.dispose(), [speech]);

  const speak = async () => {
    const [audio, text] = await Promise.all([
      fetch(SAMPLE_AUDIO).then((r) => r.arrayBuffer()),
      fetch(SAMPLE_TEXT).then((r) => r.text()),
    ]);
    await speech.load(audio, { text });
    setSpeaking(true);
    await speech.play(() => setSpeaking(false));
  };

  return (
    <main className="relative h-dvh w-full">
      <Stage
        key={String(post)}
        focus={focus}
        post={post}
        look={model.look}
        subjectHeight={subjectHeight}
        className="absolute inset-0"
      >
        {model.look === 'anime' ? (
          <VrmAvatar
            key={modelId}
            baseUrl={model.url}
            parts={OUTFITS[outfit]}
            bodyShape={{ build, height: 1 }}
            tints={TINTS[tint]}
            speech={speech}
            onMeasured={(height) => setMeasured({ id: modelId, height })}
          />
        ) : (
          <Character key={`${modelId}-${sss}`} url={model.url} sss={sss} speech={speech} />
        )}
        <DebugHandle />
        {stats && <StatsGl className="!top-auto !bottom-3 !left-3" />}
      </Stage>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap gap-2 p-3 font-sans text-xs">
        <Toggle options={Object.keys(MODELS) as ModelId[]} value={modelId} onChange={setModelId} />
        <Toggle options={FOCUSES} value={focus} onChange={setFocus} />
        <Toggle options={Object.keys(OUTFITS) as OutfitId[]} value={outfit} onChange={setOutfit} />
        <Toggle options={BODY_BUILDS} value={build} onChange={setBuild} />
        <Toggle options={Object.keys(TINTS) as TintId[]} value={tint} onChange={setTint} />
        <Toggle
          options={['sss on', 'sss off']}
          value={sss ? 'sss on' : 'sss off'}
          onChange={(v) => setSss(v === 'sss on')}
        />
        <button
          type="button"
          onClick={() => void speak()}
          disabled={speaking}
          className="pointer-events-auto rounded-full bg-neutral-900 px-4 py-1.5 text-white disabled:opacity-50"
        >
          {speaking ? 'speaking…' : 'speak (tr)'}
        </button>
        <Toggle
          options={['post on', 'post off']}
          value={post ? 'post on' : 'post off'}
          onChange={(v) => setPost(v === 'post on')}
        />
        <Toggle
          options={['stats off', 'stats on']}
          value={stats ? 'stats on' : 'stats off'}
          onChange={(v) => setStats(v === 'stats on')}
        />
      </div>
    </main>
  );
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="pointer-events-auto flex overflow-hidden rounded-full border border-black/10 bg-white/80 backdrop-blur">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`px-3 py-1.5 transition-colors ${
            option === value ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-black/5'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** Exposes renderer internals on window for browser-driven inspection. */
function DebugHandle() {
  const state = useThree();
  useEffect(() => {
    (window as unknown as { __spike?: unknown }).__spike = state;
  }, [state]);
  return null;
}
