'use client';

import { StatsGl } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';

import { Character } from '@/features/avatar/Character';
import type { CameraFocus } from '@/features/avatar/cameraFocus';
import { Stage } from '@/features/avatar/Stage';
import { SpeechPlayer } from '@/features/lipsync/speechPlayer';

const SAMPLE_AUDIO = '/assets/samples/tr-greeting.wav';
const SAMPLE_TEXT = '/assets/samples/tr-greeting.txt';

const CHARACTERS = {
  male: '/assets/spike/base_male.glb',
  female: '/assets/spike/base_female.glb',
} as const;

const FOCUSES: CameraFocus[] = ['body', 'torso', 'face', 'legs', 'feet'];

type Gender = keyof typeof CHARACTERS;

/** Developer-only comparison bench for the realism spike (not product UI). */
export function SpikeScene() {
  const [gender, setGender] = useState<Gender>('male');
  const [focus, setFocus] = useState<CameraFocus>('body');
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
      <Stage key={String(post)} focus={focus} post={post} className="absolute inset-0">
        <Character key={`${gender}-${sss}`} url={CHARACTERS[gender]} sss={sss} speech={speech} />
        <DebugHandle />
        {stats && <StatsGl className="!top-auto !bottom-3 !left-3" />}
      </Stage>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap gap-2 p-3 font-sans text-xs">
        <Toggle options={Object.keys(CHARACTERS) as Gender[]} value={gender} onChange={setGender} />
        <Toggle options={FOCUSES} value={focus} onChange={setFocus} />
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
