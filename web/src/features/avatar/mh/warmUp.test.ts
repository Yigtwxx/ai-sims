import { BoxGeometry, Mesh, MeshStandardMaterial, Object3D, Scene, Texture } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { texturesOf, warmUp, type WarmUpRenderer } from './warmUp';

function character() {
  const material = new MeshStandardMaterial({ map: new Texture(), normalMap: new Texture() });
  material.userData.skinUniforms = { cavity: { value: new Texture() }, gain: { value: 1 } };
  const root = new Object3D();
  root.add(new Mesh(new BoxGeometry(), material));
  return root;
}

function renderer() {
  return {
    initTexture: vi.fn(),
    compileAsync: vi.fn(() => Promise.resolve(new Object3D())),
  } satisfies WarmUpRenderer;
}

const camera = new Object3D() as never;
const scene = new Scene();

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

  it('passes a failed compile on to the caller', async () => {
    const gl = renderer();
    gl.compileAsync.mockRejectedValueOnce(new Error('lost context'));
    await expect(warmUp(gl, character(), camera, scene, () => true)).rejects.toThrow(
      'lost context',
    );
  });
});
