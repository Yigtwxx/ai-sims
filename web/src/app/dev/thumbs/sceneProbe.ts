import { _roots } from '@react-three/fiber';
import type { Object3D, SkinnedMesh } from 'three';

import type { ThumbKind } from '@/components/dev/thumbTargets';

/**
 * Dev-bench probe into the stage's three.js scene (through the R3F root of
 * its canvas): is the item really drawn yet? The character stays hidden until
 * its skin textures are bound, and a groom is added as `<slot>_core` once it is
 * loaded and fitted, seconds after the first frame.
 */
export function onStage(canvas: HTMLCanvasElement, kind: ThumbKind): boolean {
  const scene: Object3D | undefined = _roots.get(canvas)?.store.getState().scene;
  if (!scene) return false;
  let character = false;
  let item = kind === 'face';
  // traverseVisible skips hidden subtrees, so a character still waiting for
  // its skin contributes nothing.
  scene.traverseVisible((node) => {
    if (!(node as SkinnedMesh).isSkinnedMesh) return;
    character = true;
    if (node.name === `${kind}_core`) item = true;
  });
  return character && item;
}
