import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Scene,
  Texture,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  texturesIn,
  texturesOf,
  uploadTextures,
  warmUp,
  watchSceneTarget,
  type WarmUpRenderer,
} from './warmUp';

function character() {
  const material = new MeshStandardMaterial({ map: new Texture(), normalMap: new Texture() });
  material.userData.skinUniforms = {
    skinMicroNormal: { value: new Texture() },
    gain: { value: 1 },
  };
  const root = new Object3D();
  root.add(new Mesh(new BoxGeometry(), material));
  return root;
}

function renderer() {
  let target: WebGLRenderTarget | null = null;
  const gl = {
    initTexture: vi.fn(),
    // Records the target bound while each compile picks its programs.
    compiledFor: [] as (WebGLRenderTarget | null)[],
    compileAsync: vi.fn((object: Object3D) => {
      gl.compiledFor.push(target);
      return Promise.resolve(object);
    }),
    getRenderTarget: vi.fn(() => target),
    setRenderTarget: vi.fn((next: WebGLRenderTarget | null) => {
      target = next;
    }),
  } satisfies WarmUpRenderer & { compiledFor: unknown[] };
  return gl;
}

/** Has three call the scene's render hook as it does when drawing into `target`. */
function draw(world: Scene, target: WebGLRenderTarget | null) {
  world.onBeforeRender(
    {} as WebGLRenderer,
    world,
    camera,
    target as never,
    null as never,
    null as never,
  );
}

const camera = new Object3D() as never;
const scene = new Scene();

describe('texturesIn', () => {
  it('finds textures in nested texture sets and skips the rest', () => {
    const [a, b, c] = [new Texture(), new Texture(), new Texture()];
    const set = { face: { albedo: a, wrinkles: [b, null] }, body: { srmf: null }, gain: 1 };
    expect(texturesIn([set, { color: c }, null])).toEqual(new Set([a, b, c]));
  });
});

describe('warmUp', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds textures in material slots and shader uniform groups', () => {
    expect(texturesOf(character()).size).toBe(3);
  });

  it('uploads every texture, then compiles', async () => {
    const gl = renderer();
    await expect(warmUp(gl, character(), camera, scene, () => true)).resolves.toBe(true);
    expect(gl.initTexture).toHaveBeenCalledTimes(3);
    expect(gl.compileAsync).toHaveBeenCalledTimes(1);
  });

  it('stops before the next upload and never compiles once overtaken', async () => {
    const gl = renderer();
    let live = true;
    gl.initTexture.mockImplementation(() => {
      live = false;
    });
    await expect(warmUp(gl, character(), camera, scene, () => live)).resolves.toBe(false);
    expect(gl.initTexture).toHaveBeenCalledTimes(1);
    expect(gl.compileAsync).not.toHaveBeenCalled();
  });

  it('compiles each part about to go on, none of them in the scene yet', async () => {
    const gl = renderer();
    const parts = [character(), character()];
    await expect(warmUp(gl, parts, camera, scene, () => true)).resolves.toBe(true);
    expect(gl.initTexture).toHaveBeenCalledTimes(6);
    expect(gl.compileAsync).toHaveBeenCalledTimes(2);
    expect(gl.compileAsync).toHaveBeenCalledWith(parts[1], camera, scene);
  });

  it('uploads a texture once, again only after it changed', async () => {
    const gl = renderer();
    const texture = new Texture();
    await uploadTextures(gl, [texture], () => true);
    await uploadTextures(gl, [texture], () => true);
    expect(gl.initTexture).toHaveBeenCalledTimes(1);
    texture.needsUpdate = true;
    await uploadTextures(gl, [texture], () => true);
    expect(gl.initTexture).toHaveBeenCalledTimes(2);
  });

  it('compiles for a post stack buffer when the scene is drawn off screen', async () => {
    const world = new Scene();
    watchSceneTarget(world);
    const gl = renderer();
    await warmUp(gl, character(), camera, world, () => true);
    expect(gl.compiledFor).toEqual([null]);

    draw(world, new WebGLRenderTarget(1, 1));
    await warmUp(gl, character(), camera, world, () => true);
    expect(gl.compiledFor[1]).toBeInstanceOf(WebGLRenderTarget);
    // The renderer's own target is back once the programs are chosen.
    expect(gl.getRenderTarget()).toBeNull();

    draw(world, null);
    await warmUp(gl, character(), camera, world, () => true);
    expect(gl.compiledFor[2]).toBeNull();
  });

  it('keeps the scene hook it wraps', () => {
    const world = new Scene();
    const hook = vi.fn();
    world.onBeforeRender = hook;
    watchSceneTarget(world);
    watchSceneTarget(world);
    draw(world, null);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('passes a failed compile on to the caller', async () => {
    const gl = renderer();
    gl.compileAsync.mockRejectedValueOnce(new Error('lost context'));
    await expect(warmUp(gl, character(), camera, scene, () => true)).rejects.toThrow(
      'lost context',
    );
  });
});
