import { _roots } from '@react-three/fiber';
import type { Object3D, SkinnedMesh } from 'three';

import type { ThumbTarget } from '@/components/dev/thumbTargets';

/**
 * Dev-bench probe into the stage's three.js scene (through the R3F root of
 * its canvas): is the item really drawn yet? The character stays hidden until
 * its skin textures are bound, a groom is added as `<slot>_core` once it is
 * loaded and fitted, seconds after the first frame, and an outfit's garments
 * as `<category>_<mesh>` once they are bound to the body.
 */
export function onStage(
  canvas: HTMLCanvasElement,
  target: Pick<ThumbTarget, 'kind' | 'category'>,
): boolean {
  const scene: Object3D | undefined = _roots.get(canvas)?.store.getState().scene;
  if (!scene) return false;
  const { kind } = target;
  const outfitPrefix = kind === 'outfit' ? `${target.category ?? 'full'}_` : null;
  let character = false;
  let item = kind === 'face';
  // traverseVisible skips hidden subtrees, so a character still waiting for
  // its skin contributes nothing.
  scene.traverseVisible((node) => {
    if (!(node as SkinnedMesh).isSkinnedMesh) return;
    character = true;
    if (outfitPrefix ? node.name.startsWith(outfitPrefix) : node.name === `${kind}_core`) {
      item = true;
    }
  });
  return character && item;
}
