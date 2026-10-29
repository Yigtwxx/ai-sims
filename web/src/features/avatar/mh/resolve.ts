import { Color } from 'three';

import { assetUrl, type MhIris, type MhManifest, type MhSkin } from '@/lib/assets/manifest';
import type { BodySlider, CharacterConfig } from '@/lib/character/schema';

import type { IrisTint } from './eyeMaterials';
import type { GroomWear } from './hair';
import type { Rgb } from './hairColor';
import type { HairLook } from './hairMaterial';
import type { MocapLayer } from './motion';
import type { OutfitWear } from './outfits';

/** Standing heights (m) of the neutral MetaHuman bodies (pipeline bodies job). */
export const BASE_HEIGHT = { female: 1.66, male: 1.78 } as const;
/** The height slider spans ±14 cm (pipeline bodies job, SLIDERS["height"]). */
export const HEIGHT_RANGE = 0.14;

/** Most faces a character blends towards at once (the creator offers three). */
export const MAX_BLEND_FACES = 3;

/** A head the face leans towards and how far, 0..1. */
export interface FaceBlendWear {
  headUrl: string;
  weight: number;
}

export interface ResolvedCharacter {
  gender: CharacterConfig['base'];
  faceId: string;
  headUrl: string;
  bodyUrl: string;
  sliders: Partial<Record<BodySlider, number>>;
  /** Skin set to wear: the configured one, else the face's own, else none (GLB materials). */
  skin: MhSkin | null;
  makeup: boolean;
  /** Fine tone adjustment of the skin set, -1 lighter .. 1 darker. */
  skinTone: number;
  /** Eyes: the configured iris, else the face's default, else the iris named like the face. */
  iris: MhIris | null;
  /** Colour laid over the iris, or null for its own. */
  irisTint: IrisTint | null;
  /** Heads the face leans towards (see faceBlends); empty for a plain preset. */
  blend: FaceBlendWear[];
  /** Body idle clips and how much of the body they drive (see idleSet). */
  idleClips: string[];
  idleLayer: MocapLayer;
  /** Full-body clips for speaking (gestures) and listening (see gestureSet). */
  talkClips: string[];
  listenClips: string[];
  /** Hair, eyebrows, beard and mustache the manifest has, with their colour. */
  grooms: GroomWear[];
  /** Outfit items with a mesh for this body, one-piece first, with their colours. */
  outfits: OutfitWear[];
  /** The body wears an underwear top where no top covers it (the female body). */
  underwearTop: boolean;
  /** Face loops under the live face: the idle loop and a happy loop for the smile. */
  faceClips: { idle: string | null; smile: string | null };
  /** Approximate standing height (m), for camera framing. */
  height: number;
}

/**
 * Maps a render-independent config onto manifest files. A face the manifest no
 * longer has (curated out, renamed) falls back to the first face of the same
 * gender so a saved character still renders. Returns null when the manifest has
 * no body or face for the gender at all.
 */
export function resolveCharacter(
  config: CharacterConfig,
  manifest: MhManifest,
): ResolvedCharacter | null {
  const gender = config.base;
  const body = manifest.bodies.find((b) => b.gender === gender);
  const face =
    manifest.faces.find((f) => f.id === config.face.preset) ??
    manifest.faces.find((f) => f.gender === gender);
  if (!body || !face) return null;
  const sliders = config.body.sliders;
  const skin =
    manifest.skins.find((s) => s.id === config.skin.set) ??
    manifest.skins.find((s) => s.id === face.defaultSkin) ??
    null;
  // Faces exported without eyes of their own borrow the iris of the preset
  // their skin comes from, so they never render with white eyes.
  const iris =
    manifest.irises.find((i) => i.id === config.eyes.iris) ??
    manifest.irises.find((i) => i.id === face.defaultIris) ??
    manifest.irises.find((i) => presetOf(i.id) === presetOf(face.id)) ??
    (skin && manifest.irises.find((i) => presetOf(i.id) === presetOf(skin.id))) ??
    manifest.irises[0] ??
    null;
  return {
    gender,
    faceId: face.id,
    headUrl: assetUrl(face.head),
    bodyUrl: assetUrl(body.glb),
    sliders,
    skin,
    makeup: config.skin.makeup,
    skinTone: config.skin.tone,
    iris,
    irisTint: config.eyes.color ? irisTint(config.eyes.color, iris) : null,
    blend: faceBlends(config, manifest, face),
    ...idleSet(manifest),
    ...gestureSet(manifest),
    grooms: groomWears(config, manifest),
    outfits: outfitWears(config, manifest),
    underwearTop: gender === 'female',
    faceClips: faceClipSet(manifest),
    height: BASE_HEIGHT[gender] + (sliders.height ?? 0) * HEIGHT_RANGE,
  };
}

/**
 * Faces to blend towards: in the manifest, of the worn face's gender, not the
 * worn face itself and with a positive weight; the MAX_BLEND_FACES heaviest,
 * heaviest first (ties by id, so the order is stable).
 */
export function faceBlends(
  config: CharacterConfig,
  manifest: MhManifest,
  worn: MhManifest['faces'][number],
): FaceBlendWear[] {
  return Object.entries(config.face.blend)
    .flatMap(([id, weight]) => {
      const face = manifest.faces.find((f) => f.id === id);
      if (!face || face.id === worn.id || face.gender !== worn.gender || !(weight > 0)) return [];
      return [{ id, headUrl: assetUrl(face.head), weight }];
    })
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, MAX_BLEND_FACES)
    .map(({ headUrl, weight }) => ({ headUrl, weight }));
}

/** The face idle loop and the first happy expression loop, by manifest tags. */
export function faceClipSet(manifest: MhManifest): ResolvedCharacter['faceClips'] {
  const face = manifest.animations.filter((a) => a.kind === 'face');
  const idle = face.find((a) => a.tags.includes('idle'));
  const smile = face.find((a) => a.tags.includes('expression') && a.tags.includes('happy'));
  return {
    idle: idle ? assetUrl(idle.file) : null,
    smile: smile ? assetUrl(smile.file) : null,
  };
}

/** Preset name of a manifest id ("face.Ada", "iris.Ada" and "Ada" are all "Ada"). */
const presetOf = (id: string) => id.slice(id.indexOf('.') + 1);

/** sRGB hex as a linear colour (three converts on parse). */
function linear(hex: string): Rgb {
  const color = new Color(hex);
  return [color.r, color.g, color.b];
}

/**
 * The eye tint against the worn iris's brightness (its swatch is the median of
 * the iris ring). Without an iris the tint has nothing to keep and is drawn as is.
 */
function irisTint(hex: string, iris: MhIris | null): IrisTint {
  const [r, g, b] = iris ? linear(iris.swatch) : linear(hex);
  return { color: linear(hex), reference: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

/**
 * Grooms to wear. Facial hair shares the hair colour (natural or dyed) but not
 * its pattern: ombre eyebrows are not a look. Styles the manifest lacks are
 * skipped.
 */
export function groomWears(config: CharacterConfig, manifest: MhManifest): GroomWear[] {
  const { color, pattern } = config.hair;
  const natural = {
    melanin: color.melanin,
    redness: color.redness,
    dye: color.dye ? linear(color.dye) : null,
  };
  const hair: HairLook = {
    ...natural,
    pattern: pattern.type,
    patternColor: linear(pattern.color),
    patternAmount: pattern.amount,
  };
  const facial: HairLook = {
    ...natural,
    pattern: 'none',
    patternColor: [1, 1, 1],
    patternAmount: 0,
  };
  const picks: [string | null, HairLook][] = [
    [config.hair.style, hair],
    [config.eyebrows.style, facial],
    [config.beard.style, facial],
    [config.mustache.style, facial],
  ];
  return picks.flatMap(([id, look]) => {
    const groom = id ? manifest.grooms.find((g) => g.id === id) : undefined;
    return groom ? [{ groom, look }] : [];
  });
}

/**
 * Outfit items to wear: the tint preset's colours under the creator's own
 * picks (sRGB hex in the config, linear here). Items without a mesh for the
 * body are skipped.
 */
export function outfitWears(config: CharacterConfig, manifest: MhManifest): OutfitWear[] {
  const { full, top, bottom, shoes } = config.outfit;
  return [full, top, bottom, shoes].flatMap((item) => {
    const outfit = item && manifest.outfits.find((o) => o.id === item.id);
    const file = outfit?.files[config.base];
    if (!item || !outfit || !file) return [];
    const preset = outfit.tintPresets.find((p) => p.id === item.tint);
    const hexes: Record<string, string> = {};
    for (const [name, value] of Object.entries(preset?.values ?? {})) {
      if (typeof value === 'string') hexes[name] = value;
    }
    Object.assign(hexes, item.colors);
    const colors = Object.fromEntries(
      Object.entries(hexes).map(([name, hex]) => [name, linear(hex)]),
    );
    return [{ outfit, file, colors }];
  });
}

/**
 * Fewer calm clips than this would loop visibly; the body layer of standing
 * ones is used then. Two do: relax and the HumanIK stand loop take turns (the
 * third, `listening`, holds the hands behind the back and is not calm).
 */
export const MIN_CALM_IDLES = 2;

/**
 * Idle clips (manifest body animations tagged "idle"), with the retarget
 * script's tags: "calm" clips may drive the whole body; "standing" ones only
 * the pelvis, spine and legs (their hands hold phones, cross, touch the face).
 */
export function idleSet(manifest: MhManifest): Pick<ResolvedCharacter, 'idleClips' | 'idleLayer'> {
  const idles = manifest.animations.filter((a) => a.kind === 'body' && a.tags.includes('idle'));
  const calm = idles.filter((a) => a.tags.includes('calm'));
  if (calm.length >= MIN_CALM_IDLES) {
    return { idleClips: calm.map((a) => assetUrl(a.file)), idleLayer: 'full' };
  }
  return {
    idleClips: idles.filter((a) => a.tags.includes('standing')).map((a) => assetUrl(a.file)),
    idleLayer: 'body',
  };
}

/** Body clips tagged "talk" (speaking gestures) and "listen"; both drive the whole body. */
export function gestureSet(
  manifest: MhManifest,
): Pick<ResolvedCharacter, 'talkClips' | 'listenClips'> {
  const tagged = (tag: string) =>
    manifest.animations
      .filter((a) => a.kind === 'body' && a.tags.includes(tag))
      .map((a) => assetUrl(a.file));
  return { talkClips: tagged('talk'), listenClips: tagged('listen') };
}
