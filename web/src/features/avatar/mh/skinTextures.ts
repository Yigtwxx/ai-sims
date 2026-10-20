import {
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Material,
  type MeshPhysicalMaterial,
  type Texture,
  type WebGLArrayRenderTarget,
  type WebGLRenderer,
} from 'three';

import { assetUrl, type MhIris, type MhSkin } from '@/lib/assets/manifest';

import { ktx2LoaderFor } from './loaders';
import { packMaskArray } from './maskArray';
import type { WrinkleUniforms } from './materials';
import { WRINKLE_MASK_LAYERS } from './wrinkles';

/**
 * Skin sets are separate from heads (any face can wear any preset's skin), so
 * their textures load on their own: KTX2 from the converter (UASTC, colour
 * space read from the file), PNG/JPEG/WebP as a fallback.
 */

export interface SkinTextures {
  face: {
    albedo: Texture;
    normal: Texture;
    srmf: Texture | null;
    cavity: Texture | null;
    /** wm1..wm3 when the skin has wrinkle maps. */
    wrinkleNormals: Texture[] | null;
  };
  body: {
    albedo: Texture;
    normal: Texture;
    srmf: Texture | null;
    cavity: Texture | null;
  };
  /** The ten region masks packed into one array texture (shared across skins). */
  masks: Texture | null;
}

type Role = 'color' | 'data';

const textures = new Map<string, Promise<Texture>>();

function loadTexture(renderer: WebGLRenderer, file: string, role: Role): Promise<Texture> {
  const url = assetUrl(file);
  let pending = textures.get(url);
  if (!pending) {
    pending = (
      url.endsWith('.ktx2')
        ? ktx2LoaderFor(renderer).loadAsync(url)
        : new TextureLoader().loadAsync(url).then((texture) => {
            // glTF UV convention: images are not flipped.
            texture.flipY = false;
            if (role === 'color') texture.colorSpace = SRGBColorSpace;
            return texture;
          })
    ).then((texture) => {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.anisotropy = 8;
      return texture;
    });
    // A failed request is retried by the next caller.
    pending.catch(() => textures.delete(url));
    textures.set(url, pending);
  }
  return pending;
}

const optional = (renderer: WebGLRenderer, file: string | undefined, role: Role) =>
  file ? loadTexture(renderer, file, role) : Promise.resolve(null);

const maskArrays = new Map<string, Promise<WebGLArrayRenderTarget>>();

/** Masks by layer name; files are matched by stem, whatever order the manifest lists them in. */
function maskArray(renderer: WebGLRenderer, files: readonly string[]): Promise<Texture> | null {
  const ordered = WRINKLE_MASK_LAYERS.map((layer) =>
    files.find((file) => file.replace(/^.*\//, '').replace(/\.[^.]+$/, '') === layer),
  );
  if (ordered.some((file) => !file)) return null;
  const key = ordered.join('|');
  let pending = maskArrays.get(key);
  if (!pending) {
    pending = Promise.all(ordered.map((file) => loadTexture(renderer, file!, 'data'))).then(
      (masks) => {
        const target = packMaskArray(renderer, masks);
        // The sources are only needed for the copy.
        for (const mask of masks) {
          mask.dispose();
          textures.delete(assetUrl(ordered[masks.indexOf(mask)]!));
        }
        return target;
      },
    );
    maskArrays.set(key, pending);
  }
  return pending.then((target) => target.texture);
}

/** Loads (or reuses) every texture a skin set needs. */
export async function loadSkinTextures(
  renderer: WebGLRenderer,
  skin: MhSkin,
  { makeup = false }: { makeup?: boolean } = {},
): Promise<SkinTextures> {
  const face = skin.face;
  const wrinkleFiles = face.wrinkleNormal.length === 3 ? face.wrinkleNormal : null;
  const [
    albedo,
    normal,
    srmf,
    cavity,
    wrinkleNormals,
    bodyAlbedo,
    bodyNormal,
    bodySrmf,
    bodyCavity,
    masks,
  ] = await Promise.all([
    loadTexture(renderer, makeup && skin.makeupAlbedo ? skin.makeupAlbedo : face.albedo, 'color'),
    loadTexture(renderer, face.normal, 'data'),
    optional(renderer, face.srmf, 'data'),
    optional(renderer, face.cavity, 'data'),
    wrinkleFiles
      ? Promise.all(wrinkleFiles.map((file) => loadTexture(renderer, file, 'data')))
      : Promise.resolve(null),
    loadTexture(renderer, skin.body.albedo, 'color'),
    loadTexture(renderer, skin.body.normal, 'data'),
    optional(renderer, skin.body.srmf, 'data'),
    optional(renderer, skin.body.cavity, 'data'),
    wrinkleFiles ? (maskArray(renderer, face.wrinkleMasks) ?? Promise.resolve(null)) : null,
  ]);
  return {
    face: { albedo, normal, srmf, cavity, wrinkleNormals },
    body: { albedo: bodyAlbedo, normal: bodyNormal, srmf: bodySrmf, cavity: bodyCavity },
    masks,
  };
}

/** How much the cavity map removes specular from pores and creases. */
export const CAVITY_STRENGTH = 0.7;

interface SkinUniforms {
  skinCavity: { value: Texture | null };
  skinCavityStrength: { value: number };
}

/**
 * Puts a skin set on the character's skin materials (head_skin gets the face
 * maps, body_skin the body maps). Safe to call again when the skin changes.
 */
export function bindSkinTextures(materials: readonly Material[], textures: SkinTextures): void {
  for (const material of materials) {
    const skin = material as MeshPhysicalMaterial;
    const uniforms = skin.userData.skinUniforms as SkinUniforms | undefined;
    if (!uniforms) continue;
    const isHead = skin.name.startsWith('head');
    const set = isHead ? textures.face : textures.body;
    skin.map = set.albedo;
    skin.normalMap = set.normal;
    // Our GLBs carry no tangents, so three derives them and glTF normal maps
    // need y flipped, as GLTFLoader does for embedded maps.
    skin.normalScale.set(1, -1);
    skin.roughnessMap = set.srmf;
    skin.specularIntensityMap = set.srmf;
    skin.roughness = set.srmf ? 1 : 0.5;
    uniforms.skinCavity.value = set.cavity;
    uniforms.skinCavityStrength.value = set.cavity ? CAVITY_STRENGTH : 0;
    const wrinkles = skin.userData.wrinkleUniforms as WrinkleUniforms | null | undefined;
    if (isHead && wrinkles) {
      const normals = textures.face.wrinkleNormals;
      wrinkles.wrinkleNormal1.value = normals?.[0] ?? null;
      wrinkles.wrinkleNormal2.value = normals?.[1] ?? null;
      wrinkles.wrinkleNormal3.value = normals?.[2] ?? null;
      wrinkles.wrinkleMasks.value = normals ? textures.masks : null;
    }
    skin.needsUpdate = true;
  }
}

export interface IrisTextures {
  color: Texture;
  normal: Texture | null;
}

/** Eyeball maps of an iris entry (sclera, iris and their normal, per preset). */
export async function loadIrisTextures(
  renderer: WebGLRenderer,
  iris: MhIris,
): Promise<IrisTextures> {
  const [color, normal] = await Promise.all([
    loadTexture(renderer, iris.color, 'color'),
    optional(renderer, iris.normal, 'data'),
  ]);
  return { color, normal };
}
