import {
  WebGLRenderTarget,
  type Camera,
  type Mesh,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

/** The renderer calls a warm-up makes (a fake one in tests). */
export type WarmUpRenderer = Pick<
  WebGLRenderer,
  'initTexture' | 'compileAsync' | 'getRenderTarget' | 'setRenderTarget'
>;

/** Whether each watched scene was last drawn into a render target (a post stack). */
const drawnOffscreen = new WeakMap<Scene, boolean>();

/**
 * Starts noting where the scene is drawn. A shader compiled for the canvas
 * (sRGB output) is not the one drawn into a post stack's buffer (linear
 * output), so a warm-up must compile for the same target or it compiles
 * programs nobody uses and the first frame still compiles the real ones.
 */
export function watchSceneTarget(scene: Scene): void {
  if (drawnOffscreen.has(scene)) return;
  drawnOffscreen.set(scene, false);
  const previous = scene.onBeforeRender.bind(scene);
  // For a scene, three passes the render target it draws into where the
  // typings name a geometry.
  scene.onBeforeRender = (renderer, drawn, camera, target, material, group) => {
    drawnOffscreen.set(scene, (target as unknown as WebGLRenderTarget | null) !== null);
    previous(renderer, drawn, camera, target, material, group);
  };
}

/** Compiles with the scene's last draw target bound, so the programs are the ones it draws with. */
function compileFor(
  gl: WarmUpRenderer,
  object: Object3D,
  camera: Camera,
  scene: Scene,
): Promise<Object3D> {
  if (!drawnOffscreen.get(scene)) return gl.compileAsync(object, camera, scene);
  const previous = gl.getRenderTarget();
  gl.setRenderTarget((offscreen ??= new WebGLRenderTarget(1, 1)));
  try {
    // The program choice happens now; the wait for the driver comes after.
    return gl.compileAsync(object, camera, scene);
  } finally {
    gl.setRenderTarget(previous);
  }
}

/** Stand-in target bound while compiling for a scene drawn off screen. */
let offscreen: WebGLRenderTarget | null = null;

/** Every texture a character's materials sample, uniforms of patched shaders included. */
export function texturesOf(root: Object3D): Set<Texture> {
  const found = new Set<Texture>();
  const take = (value: unknown) => {
    if ((value as Texture | null)?.isTexture) found.add(value as Texture);
    else if (Array.isArray(value)) value.forEach(take);
  };
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      Object.values(material).forEach(take);
      // Uniform groups the skin, hair and fabric shaders keep in userData.
      for (const group of Object.values(material.userData)) {
        if (group && typeof group === 'object') {
          for (const uniform of Object.values(group as Record<string, { value?: unknown }>)) {
            take(uniform?.value);
          }
        }
      }
    }
  });
  return found;
}

/**
 * Every texture in a loaded texture set (nested records and lists of them,
 * e.g. a skin's face and body maps), before it is bound to any material.
 */
export function texturesIn(value: unknown, found = new Set<Texture>()): Set<Texture> {
  if ((value as Texture | null)?.isTexture) found.add(value as Texture);
  else if (Array.isArray(value)) for (const item of value) texturesIn(item, found);
  else if (value && Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value)) texturesIn(item, found);
  }
  return found;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Texture versions already uploaded by a warm-up, so shared maps do not cost a frame again. */
const uploaded = new WeakMap<Texture, number>();

/**
 * Uploads textures one per frame, skipping those a warm-up already uploaded.
 * Stops before the next one once `current` turns false (a newer change or the
 * unmount overtook it). Resolves whether it ran to the end.
 */
export async function uploadTextures(
  gl: Pick<WebGLRenderer, 'initTexture'>,
  textures: Iterable<Texture>,
  current: () => boolean,
): Promise<boolean> {
  for (const texture of textures) {
    if (uploaded.get(texture) === texture.version) continue;
    if (!current()) return false;
    gl.initTexture(texture);
    uploaded.set(texture, texture.version);
    await nextFrame();
  }
  return current();
}

/**
 * Uploads the textures of a character, or of parts about to be put on it, one
 * per frame, then compiles their materials against the scene's lights (with
 * the parallel-compile extension this does not block the page). Parts need
 * not be in the scene yet. Stops before the next step once `current` turns
 * false: the textures and materials may be disposed by then, and compiling a
 * disposed material leaks its program. Resolves whether it ran to the end.
 */
export async function warmUp(
  gl: WarmUpRenderer,
  parts: Object3D | readonly Object3D[],
  camera: Camera,
  scene: Scene,
  current: () => boolean,
): Promise<boolean> {
  const objects: readonly Object3D[] = 'isObject3D' in parts ? [parts] : parts;
  const textures = new Set<Texture>();
  for (const object of objects) for (const texture of texturesOf(object)) textures.add(texture);
  if (!(await uploadTextures(gl, textures, current))) return false;
  await Promise.all(objects.map((object) => compileFor(gl, object, camera, scene)));
  return current();
}
