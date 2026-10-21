import type { Camera, Mesh, Object3D, Scene, Texture, WebGLRenderer } from 'three';

/** The renderer calls a warm-up makes (a fake one in tests). */
export type WarmUpRenderer = Pick<WebGLRenderer, 'initTexture' | 'compileAsync'>;

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

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Uploads a character's textures one per frame, then compiles its materials.
 * Stops before the next step once `current` turns false (a newer change or the
 * unmount overtook it): its textures and materials may be disposed by then,
 * and compiling a disposed material leaks its program. Resolves whether it
 * ran to the end.
 */
export async function warmUp(
  gl: WarmUpRenderer,
  root: Object3D,
  camera: Camera,
  scene: Scene,
  current: () => boolean,
): Promise<boolean> {
  for (const texture of texturesOf(root)) {
    if (!current()) return false;
    gl.initTexture(texture);
    await nextFrame();
  }
  if (!current()) return false;
  await gl.compileAsync(root, camera, scene);
  return current();
}
