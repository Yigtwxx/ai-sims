import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';

import { loadAssetTexture } from './skinTextures';

/**
 * Packs the red channels of up to four tiling maps into one RGBA texture on
 * the GPU (KTX2 sources included, sRGB ones decoded by the sampler), so the
 * fabric shader reads them through a single texture unit. A pack is shared by
 * every garment that uses the same files and freed with its last wearer.
 */

export interface ChannelPack {
  texture: Promise<Texture>;
  /** Drops this wearer's hold; safe to call twice. */
  release(): void;
}

interface Entry {
  target: Promise<WebGLRenderTarget>;
  users: number;
}

const packs = new Map<string, Entry>();

export function acquireChannelPack(renderer: WebGLRenderer, files: readonly string[]): ChannelPack {
  const key = files.join('|');
  let entry = packs.get(key);
  if (!entry) {
    const target = Promise.all(files.map((file) => loadAssetTexture(renderer, file, 'data'))).then(
      (sources) => packRed(renderer, sources),
    );
    const created: Entry = { target, users: 0 };
    // A failed load is retried by the next wearer.
    target.catch(() => {
      if (packs.get(key) === created) packs.delete(key);
    });
    packs.set(key, created);
    entry = created;
  }
  const held = entry;
  held.users += 1;
  let released = false;
  return {
    texture: held.target.then((target) => target.texture),
    release() {
      if (released) return;
      released = true;
      held.users -= 1;
      if (held.users > 0) return;
      if (packs.get(key) === held) packs.delete(key);
      held.target.then(
        (target) => target.dispose(),
        () => undefined,
      );
    },
  };
}

const sizeOf = (texture: Texture) => {
  const image = texture.image as { width?: number; height?: number } | null;
  return { width: image?.width ?? 1, height: image?.height ?? 1 };
};

/** Channel c of the result is the red channel of sources[c], texel for texel. */
function packRed(renderer: WebGLRenderer, sources: readonly Texture[]): WebGLRenderTarget {
  const width = Math.max(...sources.map((source) => sizeOf(source).width));
  const height = Math.max(...sources.map((source) => sizeOf(source).height));
  const target = new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: UnsignedByteType,
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    anisotropy: 8,
    generateMipmaps: true,
    depthBuffer: false,
  });
  const source = (channel: number) => ({ value: sources[channel] ?? sources[0]! });
  const material = new ShaderMaterial({
    uniforms: { red: source(0), green: source(1), blue: source(2), alpha: source(3) },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D red;
      uniform sampler2D green;
      uniform sampler2D blue;
      uniform sampler2D alpha;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(
          texture2D( red, vUv ).r,
          texture2D( green, vUv ).r,
          texture2D( blue, vUv ).r,
          texture2D( alpha, vUv ).r
        );
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  // Rendering into a target also builds its mipmaps.
  renderer.render(quad, new OrthographicCamera());
  renderer.setRenderTarget(previous);
  quad.geometry.dispose();
  material.dispose();
  return target;
}
