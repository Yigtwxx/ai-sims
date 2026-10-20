/**
 * MetaHuman Creator lighting rigs, converted from the Unreal levels the
 * pipeline's lighting job dumped (raw/lighting/<Level>/lighting.json).
 *
 * Unreal is left-handed, Z up, centimetres, and the Creator character faces +Y.
 * Our scene is right-handed, Y up, metres, character facing +Z with its left at
 * +X, so a point maps as (x, y, z)ue → (x, z, y)/100. Spot intensities stay in
 * candela: three's physically based lights use the same unit.
 */

export type Vec3 = [number, number, number];

export interface UnrealSpot {
  name: string;
  /** Actor location (cm) and rotator pitch/yaw (degrees). */
  location: Vec3;
  pitch: number;
  yaw: number;
  candela: number;
  /** Half-angles of the cone (degrees). */
  innerCone: number;
  outerCone: number;
  attenuationRadius: number;
  sourceRadius: number;
  castShadows: boolean;
  /** Unreal's per-light specular scale (0 = diffuse only). */
  specular: number;
}

export interface SpotRig {
  name: string;
  position: Vec3;
  /** Point the light aims at (metres). */
  target: Vec3;
  intensity: number;
  angle: number;
  penumbra: number;
  distance: number;
  /** Soft-shadow blur derived from the source size. */
  shadowRadius: number;
  castShadow: boolean;
  specular: number;
}

export interface LightingRig {
  id: string;
  spots: SpotRig[];
  /** Uniform fill standing in for the Creator's unshadowed ambient point light. */
  ambient: number;
  /** Image-based light strength (reflections in eyes and skin). */
  environment: number;
}

const DEG = Math.PI / 180;

export function ueToScene([x, y, z]: Vec3): Vec3 {
  return [x / 100, z / 100, y / 100];
}

/** Unit forward vector of an Unreal rotator, in scene axes. */
export function ueForward(pitch: number, yaw: number): Vec3 {
  const p = pitch * DEG;
  const w = yaw * DEG;
  const forward: Vec3 = [Math.cos(p) * Math.cos(w), Math.cos(p) * Math.sin(w), Math.sin(p)];
  return [forward[0], forward[2], forward[1]];
}

export function convertSpot(spot: UnrealSpot): SpotRig {
  const position = ueToScene(spot.location);
  const forward = ueForward(spot.pitch, spot.yaw);
  const reach = 2;
  return {
    name: spot.name,
    position,
    target: [
      position[0] + forward[0] * reach,
      position[1] + forward[1] * reach,
      position[2] + forward[2] * reach,
    ],
    intensity: spot.candela,
    angle: spot.outerCone * DEG,
    penumbra: Math.min(1, Math.max(0, 1 - spot.innerCone / spot.outerCone)),
    distance: spot.attenuationRadius / 100,
    // A 75 cm softbox throws a very soft shadow; map source size to PCF radius.
    shadowRadius: Math.min(12, 2 + spot.sourceRadius / 8),
    castShadow: spot.castShadows,
    specular: spot.specular,
  };
}

/** Values copied from raw/lighting/Studio/lighting.json. */
const STUDIO: UnrealSpot[] = [
  {
    name: 'key',
    location: [-173.9, 252.4, 309.7],
    pitch: -33.4,
    yaw: -54.7,
    candela: 39,
    innerCone: 1,
    outerCone: 33,
    attenuationRadius: 1000,
    sourceRadius: 75,
    castShadows: true,
    specular: 1,
  },
  {
    name: 'bounce',
    location: [326.3, -35.5, 226.1],
    pitch: -16.5,
    yaw: 175.2,
    candela: 7.9,
    innerCone: 20,
    outerCone: 33,
    attenuationRadius: 580,
    sourceRadius: 50,
    castShadows: false,
    specular: 1,
  },
  {
    name: 'fill',
    location: [-9.2, 274.8, 35.2],
    pitch: 13.5,
    yaw: -87.9,
    candela: 9.9,
    innerCone: 15,
    outerCone: 30,
    attenuationRadius: 400,
    sourceRadius: 100,
    castShadows: false,
    specular: 0,
  },
];

/** Values copied from raw/lighting/Portrait/lighting.json (background light left out: our backdrop has its own). */
const PORTRAIT: UnrealSpot[] = [
  {
    name: 'key-left',
    location: [-141, 206, 224.1],
    pitch: -2.7,
    yaw: -73.5,
    candela: 25,
    innerCone: 45,
    outerCone: 67,
    attenuationRadius: 400,
    sourceRadius: 25,
    castShadows: true,
    specular: 1,
  },
  {
    name: 'key-right',
    location: [137, 196.4, 234.2],
    pitch: -6.6,
    yaw: -108.4,
    candela: 25,
    innerCone: 45,
    outerCone: 67,
    attenuationRadius: 400,
    sourceRadius: 25,
    castShadows: false,
    specular: 1,
  },
  {
    name: 'top',
    location: [0, 95.5, 225],
    pitch: -50,
    yaw: -90,
    candela: 1.25,
    innerCone: 0,
    outerCone: 44,
    attenuationRadius: 1000,
    sourceRadius: 2.5,
    castShadows: false,
    specular: 1,
  },
];

export const LIGHTING_RIGS: Record<'studio' | 'portrait', LightingRig> = {
  studio: { id: 'studio', spots: STUDIO.map(convertSpot), ambient: 0.12, environment: 0.35 },
  portrait: { id: 'portrait', spots: PORTRAIT.map(convertSpot), ambient: 0.2, environment: 0.45 },
};
