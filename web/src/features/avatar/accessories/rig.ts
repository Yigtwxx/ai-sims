import type { VRM } from '@pixiv/three-vrm';

import { resolveSelections, type AccessoryDef, type AccessorySelection } from './catalog';

/**
 * Accessory rig contract: build the selected accessories on an assembled
 * character, step their motion once per frame (after the pose update), and
 * remove everything on dispose.
 *
 * Status: placeholder. Selections are validated (known ids, one per slot)
 * but no meshes are assembled yet. The anime (VRoid) pipeline was dropped
 * before the item builders landed; the reusable pieces (catalogue, PBR
 * materials, geometry, surface sampling and anchor helpers) are in this
 * folder, and the rig will be completed against the realistic rig adapter.
 */
export interface AccessoryRig {
  update(dt: number): void;
  dispose(): void;
}

export interface ResolvedAccessory {
  def: AccessoryDef;
  color: string;
}

/** Builds the selected accessories and attaches them to the base's raw bones. One item per slot. */
export function createAccessoryRig(
  base: VRM,
  donors: readonly VRM[],
  selections: readonly AccessorySelection[],
): AccessoryRig & { readonly items: readonly ResolvedAccessory[] } {
  void base;
  void donors;
  const items = resolveSelections(selections);
  return {
    items,
    update() {},
    dispose() {},
  };
}
