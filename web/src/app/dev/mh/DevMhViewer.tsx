'use client';

import { useSearchParams } from 'next/navigation';
import { aimCamera } from '@/app/dev/thumbs/sceneProbe';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Stage } from '@/features/avatar/Stage';
import type { CameraFocus } from '@/features/avatar/cameraFocus';
import { stepBlink, type BlinkState } from '@/features/avatar/life';
import { BODY_SLIDER_IDS, type BodySliderId } from '@/features/avatar/mh/assembly';
import { MhCharacter, type MhCharacterHandle } from '@/features/avatar/mh/MhCharacter';
import {
  TATTOO_DESIGNS,
  TATTOO_PLACEMENTS,
  isTattooDesign,
  isTattooPlacement,
} from '@/features/creator/tattoos';
import { MhLighting } from '@/features/avatar/mh/MhLighting';
import { applyMouthToMorphs, createMouthState, stepMouth } from '@/features/lipsync/mouthDriver';
import { SpeechPlayer } from '@/features/lipsync/speechPlayer';

import { benchIris, benchSkin } from '../benchSkins';

const FACES = ['Ada', 'Aera', 'Aoi'] as const;
const ARKIT = [
  'eyeBlinkLeft',
  'eyeLookDownLeft',
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeSquintLeft',
  'eyeWideLeft',
  'eyeBlinkRight',
  'eyeLookDownRight',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeSquintRight',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawRight',
  'jawOpen',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
];
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
const ALL_MORPHS = [...ARKIT, ...VISEMES.map((v) => `viseme_${v}`)];

/**
 * Renderer bench: one MetaHuman head on a body, with body sliders, a morph
 * sweep and the Turkish speech sample driving the visemes. Dev only.
 */
export function DevMhViewer() {
  const params = useSearchParams();
  // `?face=Etta` opens any converted preset, not only the ones in the picker.
  const [face, setFace] = useState<string>(params.get('face') ?? 'Ada');
  const [gender, setGender] = useState<'female' | 'male'>(
    params.get('gender') === 'male' ? 'male' : 'female',
  );
  const [focus, setFocus] = useState<CameraFocus>((params.get('focus') as CameraFocus) ?? 'face');
  const [sliders, setSliders] = useState<Partial<Record<BodySliderId, number>>>({});
  // `?morph=eyeBlinkLeft` holds one morph at 1, `?blend=Zuri:0.5,Etta:0.3` blends the head.
  const [morph, setMorph] = useState<string>(params.get('morph') ?? '');
  const blendParam = params.get('blend') ?? '';
  // `?tattoo=all` wears one design per placement, `?tattoo=nape&design=bird` one.
  const tattooParam = params.get('tattoo') ?? '';
  const designParam = params.get('design') ?? 'star';
  // `?jewelry=ear-hoop-small,neck-pearls` wears jewellery ids.
  const jewelryParam = params.get('jewelry') ?? '';
  const accessories = useMemo(() => jewelryParam.split(',').filter(Boolean), [jewelryParam]);
  const tattoos = useMemo(() => {
    if (tattooParam === 'all') {
      return TATTOO_PLACEMENTS.map((placement, i) => ({
        design: TATTOO_DESIGNS[i % TATTOO_DESIGNS.length]!,
        placement,
      }));
    }
    return isTattooPlacement(tattooParam) && isTattooDesign(designParam)
      ? [{ design: designParam, placement: tattooParam }]
      : [];
  }, [tattooParam, designParam]);
  const blend = useMemo(
    () =>
      blendParam
        .split(',')
        .filter(Boolean)
        .map((part) => {
          const [id = '', weight = '0'] = part.split(':');
          return { headUrl: `/assets/mh/faces/${id}/head.glb`, weight: Number(weight) };
        }),
    [blendParam],
  );
  const [sweep, setSweep] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [rig, setRig] = useState<'studio' | 'portrait' | 'legacy'>('studio');
  const skinSet = useMemo(() => benchSkin(face), [face]);
  const iris = useMemo(() => benchIris(face), [face]);
  const player = useRef<SpeechPlayer | null>(null);
  const mouth = useRef(createMouthState());
  const blink = useRef<BlinkState>({ nextIn: 1.5, phase: -1 });
  const clock = useRef(0);

  const speak = useCallback(async () => {
    player.current?.dispose();
    const [audio, text] = await Promise.all([
      fetch('/assets/samples/tr-greeting.wav').then((r) => r.arrayBuffer()),
      fetch('/assets/samples/tr-greeting.txt').then((r) => r.text()),
    ]);
    const next = new SpeechPlayer();
    await next.load(audio, { text });
    player.current = next;
    setSpeaking(true);
    next.play(() => setSpeaking(false));
  }, []);

  useEffect(
    () => () => {
      void player.current?.dispose();
    },
    [],
  );
  // Console hook for close-ups: devMh.look([x, y, z], [x, y, z]) aims the camera.
  useEffect(() => {
    const look = (position: [number, number, number], target: [number, number, number]) => {
      const canvas = document.querySelector('canvas');
      return canvas ? aimCamera(canvas, { position, target }) : false;
    };
    Object.assign(window, { devMh: { look } });
    return () => {
      delete (window as { devMh?: unknown }).devMh;
    };
  }, []);

  const onFrame = useMemo(
    () => (handle: MhCharacterHandle, delta: number) => {
      clock.current += delta;
      (window as unknown as { __mh?: MhCharacterHandle }).__mh = handle;
      const t = clock.current;
      for (const name of ALL_MORPHS) handle.setFaceMorph(name, 0);
      // Speech first, so an inspected morph (visemes included) wins over it.
      const weights = player.current?.isPlaying ? player.current.sample() : {};
      stepMouth(mouth.current, weights, delta);
      applyMouthToMorphs(handle.faceMeshes, mouth.current);
      if (sweep) {
        const index = Math.floor(t / 1.2) % ALL_MORPHS.length;
        const phase = (t % 1.2) / 1.2;
        handle.setFaceMorph(ALL_MORPHS[index]!, Math.sin(phase * Math.PI));
        (window as unknown as { __mhMorph?: string }).__mhMorph = ALL_MORPHS[index];
      } else if (morph) {
        handle.setFaceMorph(morph, 1);
      }
      const step = stepBlink(blink.current, delta, Math.random);
      blink.current = step.state;
      if (!sweep && !morph) {
        handle.setFaceMorph('eyeBlinkLeft', step.weight);
        handle.setFaceMorph('eyeBlinkRight', step.weight);
      }
    },
    [sweep, morph],
  );

  return (
    <div className="relative h-full w-full">
      <Stage
        focus={focus}
        backdrop="dark"
        subjectHeight={gender === 'female' ? 1.66 : 1.78}
        lighting={rig === 'legacy' ? undefined : <MhLighting rig={rig} />}
      >
        <Suspense fallback={null}>
          <MhCharacter
            key={`${gender}-${face}`}
            bodyUrl={`/assets/mh/bodies/${gender}/body.glb`}
            headUrl={`/assets/mh/faces/${face}/head.glb`}
            blend={blend}
            sliders={sliders}
            skin={skinSet}
            iris={iris}
            underwearTop={gender === 'female'}
            tattoos={tattoos}
            accessories={accessories}
            onFrame={onFrame}
          />
        </Suspense>
      </Stage>
      <aside className="bg-paper/90 absolute top-3 left-3 flex max-h-[95vh] w-72 flex-col gap-2 overflow-y-auto rounded-lg p-3 text-xs">
        <label className="flex gap-2">
          face
          <select value={face} onChange={(e) => setFace(e.target.value)}>
            {[...new Set([...FACES, face])].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          body
          <select value={gender} onChange={(e) => setGender(e.target.value as 'female' | 'male')}>
            <option>female</option>
            <option>male</option>
          </select>
        </label>
        <label className="flex gap-2">
          light
          <select
            value={rig}
            onChange={(e) => setRig(e.target.value as 'studio' | 'portrait' | 'legacy')}
          >
            <option>studio</option>
            <option>portrait</option>
            <option>legacy</option>
          </select>
        </label>
        <label className="flex gap-2">
          focus
          <select value={focus} onChange={(e) => setFocus(e.target.value as CameraFocus)}>
            {['face', 'brows', 'mouth', 'torso', 'body', 'legs', 'feet'].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={speak}
          disabled={speaking}
          className="rounded bg-amber-400 px-2 py-1 text-black"
        >
          {speaking ? 'speaking…' : 'speak tr sample'}
        </button>
        <label className="flex gap-2">
          <input type="checkbox" checked={sweep} onChange={(e) => setSweep(e.target.checked)} />{' '}
          sweep all morphs
        </label>
        <select value={morph} onChange={(e) => setMorph(e.target.value)}>
          <option value="">— morph —</option>
          {ALL_MORPHS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        {BODY_SLIDER_IDS.map((id) => (
          <label key={id} className="flex items-center gap-2">
            <span className="w-16">{id}</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={sliders[id] ?? 0}
              onChange={(e) => setSliders((s) => ({ ...s, [id]: Number(e.target.value) }))}
            />
          </label>
        ))}
      </aside>
    </div>
  );
}
