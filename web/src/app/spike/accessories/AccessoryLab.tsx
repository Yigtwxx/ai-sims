'use client';

import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { CameraControlsImpl } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';

import type { AccessorySelection } from '@/features/avatar/accessories/catalog';
import { createAccessoryRig, type AccessoryRig } from '@/features/avatar/accessories/rig';
import type { CameraFocus } from '@/features/avatar/cameraFocus';
import { Stage } from '@/features/avatar/Stage';
import { VrmAvatar, type Assembly } from '@/features/avatar/VrmAvatar';
import { BODY_BUILDS, type BodyBuild, type BodyShape } from '@/features/avatar/vrm/bodyShape';
import type { PartSelection } from '@/features/avatar/vrm/parts';
import { findEntry, loadManifest, type VrmManifest } from '@/features/creator/manifest';

/**
 * Development tool for the accessory rig. Everything is driven by the query
 * string so screenshots can be scripted:
 *
 * /spike/accessories?base=fem_vroid__base&hair=AvatarSample_B__hair
 *   &items=ear-hoop-small,neck-pendant-heart&color=neck-pendant-heart:%23dfe3e8
 *   &focus=face&shot=ear-left&angle=-90&expr=aa:1
 *
 * - base, hair, top, bottom, shoes: manifest ids, or "none". Parts default to
 *   the base's own source model when the manifest has them.
 * - items: accessory ids. color: "#hex" for all items, or "id:#hex" pairs.
 * - focus: a creator camera preset. shot: a close-up on a body landmark
 *   (head, ear-left, ear-right, nose, lips, brow, neck, chest, wrist, navel,
 *   hair) with optional zoom.
 * - angle: turntable yaw in degrees (-90 shows the character's left side).
 * - expr: expression overrides, e.g. "aa:1,blink:0".
 * - build, height: body shape.
 */

const FOCI: CameraFocus[] = ['body', 'face', 'torso', 'legs', 'feet', 'premiere'];
const PART_KEYS = ['hair', 'top', 'bottom', 'shoes'] as const;

interface LabQuery {
  base: string;
  parts: Partial<Record<(typeof PART_KEYS)[number], string>>;
  items: AccessorySelection[];
  focus: CameraFocus;
  shot?: string;
  zoom: number;
  angle: number;
  expr: [string, number][];
  shape: BodyShape;
}

function parseQuery(search: string): LabQuery {
  const q = new URLSearchParams(search);
  const colorParam = q.get('color') ?? '';
  const colors = new Map<string, string>();
  let allColor: string | undefined;
  for (const token of colorParam.split(',').filter(Boolean)) {
    const [id, hex] = token.includes(':') ? token.split(':') : [undefined, token];
    if (id) colors.set(id, hex);
    else allColor = hex;
  }
  const items = (q.get('items') ?? '')
    .split(',')
    .filter(Boolean)
    .map((id) => ({ id, color: colors.get(id) ?? allColor }));
  const parts: LabQuery['parts'] = {};
  for (const key of PART_KEYS) {
    const value = q.get(key);
    if (value) parts[key] = value;
  }
  const focus = q.get('focus') as CameraFocus | null;
  const build = q.get('build') as BodyBuild | null;
  return {
    base: q.get('base') ?? 'fem_vroid__base',
    parts,
    items,
    focus: focus && FOCI.includes(focus) ? focus : 'face',
    shot: q.get('shot') ?? undefined,
    zoom: Number(q.get('zoom') ?? '1') || 1,
    angle: Number(q.get('angle') ?? '0') || 0,
    expr: (q.get('expr') ?? '')
      .split(',')
      .filter(Boolean)
      .map((token) => {
        const [name, value] = token.split(':');
        return [name, Number(value ?? '1')] as [string, number];
      }),
    shape: {
      build: build && BODY_BUILDS.includes(build) ? build : 'average',
      height: Number(q.get('height') ?? '1') || 1,
    },
  };
}

function resolveParts(manifest: VrmManifest, query: LabQuery): PartSelection | undefined {
  const base = findEntry(manifest, query.base);
  if (!base) return undefined;
  const parts: PartSelection = {};
  for (const key of PART_KEYS) {
    const id = query.parts[key] ?? `${base.source}__${key}`;
    if (id === 'none') {
      parts[key] = null;
      continue;
    }
    const entry = findEntry(manifest, id);
    if (entry) parts[key] = entry.url;
  }
  return parts;
}

declare global {
  interface Window {
    __lab?: { assembly?: Assembly; rig?: AccessoryRig; three: typeof THREE; ready: boolean };
  }
}

// The query string never changes while the page is open.
const subscribeToNothing = () => () => {};
const readSearch = () => window.location.search;
const noSearchOnServer = () => null;

export function AccessoryLab() {
  const search = useSyncExternalStore(subscribeToNothing, readSearch, noSearchOnServer);
  const query = useMemo(() => (search === null ? undefined : parseQuery(search)), [search]);
  const [manifest, setManifest] = useState<VrmManifest>();
  const [height, setHeight] = useState<number>();
  const [assembly, setAssembly] = useState<Assembly>();

  useEffect(() => {
    void loadManifest().then(setManifest);
  }, []);

  const base = query && manifest ? findEntry(manifest, query.base) : undefined;
  const parts = useMemo(
    () => (query && manifest ? resolveParts(manifest, query) : undefined),
    [query, manifest],
  );

  if (!query || !manifest) return null;
  if (!base || !parts) return <p className="p-6 text-sm">Unknown base: {query.base}</p>;

  return (
    <main className="fixed inset-0 bg-[#121113]">
      <Stage
        backdrop="dark"
        look="anime"
        focus={query.focus}
        subjectHeight={height}
        className="absolute inset-0"
      >
        <group rotation-y={THREE.MathUtils.degToRad(query.angle)}>
          <VrmAvatar
            baseUrl={base.url}
            parts={parts}
            bodyShape={query.shape}
            onMeasured={setHeight}
            onAssembled={setAssembly}
          />
          {assembly && <AccessoryLayer assembly={assembly} query={query} />}
        </group>
      </Stage>
    </main>
  );
}

const SHOT_BONES: Record<string, { bone: VRMHumanBoneName; distance: number; lift: number }> = {
  head: { bone: 'head', distance: 0.75, lift: 0.07 },
  'ear-left': { bone: 'head', distance: 0.42, lift: 0.04 },
  'ear-right': { bone: 'head', distance: 0.42, lift: 0.04 },
  nose: { bone: 'head', distance: 0.36, lift: 0.05 },
  lips: { bone: 'head', distance: 0.36, lift: 0.03 },
  brow: { bone: 'head', distance: 0.36, lift: 0.08 },
  hair: { bone: 'head', distance: 0.6, lift: 0.1 },
  neck: { bone: 'neck', distance: 0.7, lift: -0.02 },
  chest: { bone: 'upperChest', distance: 0.9, lift: 0 },
  wrist: { bone: 'leftHand', distance: 0.45, lift: 0.03 },
  navel: { bone: 'spine', distance: 0.6, lift: 0.02 },
};

const _target = new THREE.Vector3();

/** Builds the rig on the assembled character, drives it and frames close-ups. */
function AccessoryLayer({ assembly, query }: { assembly: Assembly; query: LabQuery }) {
  const rigRef = useRef<AccessoryRig | undefined>(undefined);
  const elapsed = useRef(0);
  const framed = useRef(false);
  const itemsKey = JSON.stringify(query.items);

  useEffect(() => {
    const items = JSON.parse(itemsKey) as AccessorySelection[];
    const rig = createAccessoryRig(assembly.base, assembly.donors, items);
    rigRef.current = rig;
    elapsed.current = 0;
    window.__lab = { assembly, rig, three: THREE, ready: false };
    return () => {
      rig.dispose();
      rigRef.current = undefined;
    };
  }, [assembly, itemsKey]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const expressions = assembly.base.expressionManager;
    if (expressions && query.expr.length > 0) {
      for (const [name, value] of query.expr) expressions.setValue(name, value);
      expressions.update();
    }
    rigRef.current?.update(dt);
    elapsed.current += dt;
    if (window.__lab && elapsed.current > 2.2) window.__lab.ready = true;

    const shot = query.shot ? SHOT_BONES[query.shot] : undefined;
    const bone = shot && assembly.base.humanoid?.getRawBoneNode(shot.bone);
    const controls = state.controls as CameraControlsImpl | null;
    if (!shot || !bone || !controls) return;
    if (!framed.current) {
      // Close-ups use a longer lens and get past the creator's dolly limit.
      const camera = state.camera as THREE.PerspectiveCamera;
      camera.zoom = query.zoom;
      camera.updateProjectionMatrix();
      controls.minDistance = 0.05;
      framed.current = true;
    }
    bone.getWorldPosition(_target);
    _target.y += shot.lift;
    void controls.setLookAt(
      _target.x,
      _target.y + 0.01,
      _target.z + shot.distance,
      _target.x,
      _target.y,
      _target.z,
      false,
    );
  });

  return null;
}
