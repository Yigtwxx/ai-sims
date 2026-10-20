import {
  Color,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MultiplyBlending,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';

/**
 * Eye materials for converted MetaHuman heads. The converter leaves the eye
 * occlusion shell, tear line and caruncle fully transparent; without the
 * occlusion the eyes look pasted on. The tear line stays hidden: a glossy
 * film there read as a white rim on the lower lid at any strength we tried. Values follow MI_eye_occlusion_unified from the
 * materials dump; its graph is not dumped, so the falloff below is our reading
 * of the parameter names: each `*Shadow` darkens inward from its UV edge
 * (radius, hardness = solid share), each `*ShadowBorder` fades the result back
 * to nothing right at that edge, where the shell meets the lids, so its rim
 * never shows on the skin.
 *
 * Shell UVs (measured on the head GLB): u = 0 outer corner .. 1 inner corner,
 * v = 0 top .. 1 bottom, mirrored for the right eye.
 */

export interface OcclusionSide {
  radius: number;
  hardness: number;
}

export interface EyeOcclusionTuning {
  top: OcclusionSide;
  topBorder: OcclusionSide;
  bottom: OcclusionSide;
  bottomBorder: OcclusionSide;
  inner: OcclusionSide;
  innerBorder: OcclusionSide;
  outer: OcclusionSide;
  outerBorder: OcclusionSide;
  tint: Color;
  /** Darkening at full occlusion (0 none .. 1 black). */
  strength: number;
}

export const MH_EYE_OCCLUSION: EyeOcclusionTuning = {
  top: { radius: 0.7504, hardness: 0.4864 },
  topBorder: { radius: 0.1844, hardness: 0 },
  bottom: { radius: 0, hardness: 0 },
  bottomBorder: { radius: 0.05, hardness: 0 },
  inner: { radius: 0.2744, hardness: 0.708 },
  innerBorder: { radius: 0.2044, hardness: 0.3824 },
  outer: { radius: 0, hardness: 0 },
  outerBorder: { radius: 0.102, hardness: 0 },
  tint: new Color(0.901, 0.901, 0.901),
  // Chosen on the dev bench against the unshaded eye: 0.15 barely reads, 0.4 hides the iris top.
  strength: 0.3,
};

/** CPU mirror of the shader falloff, for tests and tuning: 1 at the edge, 0 past `radius`. */
export function sideOcclusion(distance: number, { radius, hardness }: OcclusionSide): number {
  if (radius <= 0) return 0;
  const solid = radius * hardness;
  if (distance <= solid) return 1;
  if (distance >= radius) return 0;
  const t = (distance - solid) / (radius - solid);
  return 1 - t * t * (3 - 2 * t);
}

/** Occlusion 0..1 at a shell UV. */
export function eyeOcclusion(u: number, v: number, tuning = MH_EYE_OCCLUSION): number {
  const shadow = Math.max(
    sideOcclusion(v, tuning.top),
    sideOcclusion(1 - v, tuning.bottom),
    sideOcclusion(1 - u, tuning.inner),
    sideOcclusion(u, tuning.outer),
  );
  const rim =
    (1 - sideOcclusion(v, tuning.topBorder)) *
    (1 - sideOcclusion(1 - v, tuning.bottomBorder)) *
    (1 - sideOcclusion(1 - u, tuning.innerBorder)) *
    (1 - sideOcclusion(u, tuning.outerBorder));
  return shadow * rim;
}

const sideUniform = (side: OcclusionSide) => ({ value: [side.radius, side.hardness] });

const OCCLUSION_GLSL = /* glsl */ `
uniform vec2 occTop; uniform vec2 occTopBorder;
uniform vec2 occBottom; uniform vec2 occBottomBorder;
uniform vec2 occInner; uniform vec2 occInnerBorder;
uniform vec2 occOuter; uniform vec2 occOuterBorder;
uniform vec3 occTint;
uniform float occStrength;
float occSide( float d, vec2 side ) {
  if ( side.x <= 0.0 ) return 0.0;
  return 1.0 - smoothstep( side.x * side.y, side.x, d );
}
`;

export function createEyeOcclusionMaterial(tuning = MH_EYE_OCCLUSION): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    name: 'eyeshell_occlusion',
    transparent: true,
    depthWrite: false,
    blending: MultiplyBlending,
    premultipliedAlpha: true,
  });
  material.defines = { USE_UV: '' };
  const uniforms = {
    occTop: sideUniform(tuning.top),
    occTopBorder: sideUniform(tuning.topBorder),
    occBottom: sideUniform(tuning.bottom),
    occBottomBorder: sideUniform(tuning.bottomBorder),
    occInner: sideUniform(tuning.inner),
    occInnerBorder: sideUniform(tuning.innerBorder),
    occOuter: sideUniform(tuning.outer),
    occOuterBorder: sideUniform(tuning.outerBorder),
    occTint: { value: tuning.tint },
    occStrength: { value: tuning.strength },
  };
  // Live-tunable from the dev bench; the shader reads these objects directly.
  material.userData.occlusionUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OCCLUSION_GLSL}`)
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        /* glsl */ `
        float occShadow = max(
          max( occSide( vUv.y, occTop ), occSide( 1.0 - vUv.y, occBottom ) ),
          max( occSide( 1.0 - vUv.x, occInner ), occSide( vUv.x, occOuter ) )
        );
        float occRim = ( 1.0 - occSide( vUv.y, occTopBorder ) ) * ( 1.0 - occSide( 1.0 - vUv.y, occBottomBorder ) )
          * ( 1.0 - occSide( 1.0 - vUv.x, occInnerBorder ) ) * ( 1.0 - occSide( vUv.x, occOuterBorder ) );
        float occ = occShadow * occRim;
        vec4 diffuseColor = vec4( mix( vec3( 1.0 ), occTint, occ ) * ( 1.0 - occ * occStrength ), 1.0 );
        `,
      );
  };
  material.customProgramCacheKey = () => 'mh-eye-occlusion-v2';
  return material;
}

/**
 * Eyeball with a glossy cornea over a softer iris and sclera: the clearcoat
 * lobe carries the sharp catch-lights, the base lobe stays diffuse-looking.
 */
export function createEyeballMaterial(source: MeshStandardMaterial): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    name: `${source.name}_eyeball`,
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    roughness: 0.32,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    ior: 1.376,
  });
}

/** Replaces the eye materials of an assembled character; returns them for disposal. */
export function applyEyeMaterials(root: Object3D): Material[] {
  const created: Material[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const source = mesh.material as MeshStandardMaterial;
    let next: Material | null = null;
    if (source.name === 'eyeshell') next = createEyeOcclusionMaterial();
    else if (source.name === 'eyeLeft' || source.name === 'eyeRight') {
      next = createEyeballMaterial(source);
    }
    if (!next) return;
    mesh.userData.mhSourceMaterial = source;
    mesh.material = next;
    // Drawn after the eyeballs it darkens.
    if (source.name === 'eyeshell') mesh.renderOrder = 1;
    created.push(next);
  });
  return created;
}

/** Puts an iris set on the eyeball materials created by applyEyeMaterials. */
export function bindIrisTextures(
  materials: readonly Material[],
  textures: { color: Texture; normal: Texture | null },
): void {
  for (const material of materials) {
    if (!material.name.endsWith('_eyeball')) continue;
    const eyeball = material as MeshPhysicalMaterial;
    eyeball.map = textures.color;
    eyeball.normalMap = textures.normal;
    // No tangents in our GLBs: glTF normal maps need y flipped (as GLTFLoader does).
    eyeball.normalScale.set(1, -1);
    eyeball.needsUpdate = true;
  }
}
