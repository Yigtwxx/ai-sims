import { BackSide, CustomBlending, FrontSide, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';

import { MaterialKit } from './materials';

describe('material kit', () => {
  it('shares one material per finish and colour', () => {
    const kit = new MaterialKit();
    expect(kit.metal('#f2c46d')).toBe(kit.metal('#f2c46d'));
    expect(kit.metal('#f2c46d')).not.toBe(kit.metal('#dfe3e8'));
    expect(kit.metal('#f2c46d').metalness).toBe(1);
    // Dark metals keep a clear coat so they read glossy, not plastic.
    expect(kit.metal('#2c2c31').clearcoat).toBe(1);
    kit.dispose();
  });

  it('builds stones as inner and outer facet shells', () => {
    const kit = new MaterialKit();
    const gem = kit.gem('#3466d8');
    expect(gem.back.side).toBe(BackSide);
    expect(gem.front.side).toBe(FrontSide);
    expect(gem.front.transparent).toBe(true);
    expect(gem.front.depthWrite).toBe(false);
    expect(gem.back.flatShading && gem.front.flatShading).toBe(true);
    kit.dispose();
  });

  it('adds clear-lens reflections without hiding the eyes', () => {
    const kit = new MaterialKit();
    const lens = kit.clearLens();
    expect(lens.blending).toBe(CustomBlending);
    expect(lens.opacity).toBeLessThan(0.1);
    expect(lens.depthWrite).toBe(false);
    expect(kit.tintedLens('#2b3138').vertexColors).toBe(true);
    kit.dispose();
  });

  it('binds the environment with per-finish intensity and disposes everything', () => {
    const kit = new MaterialKit();
    const metal = kit.metal('#dfe3e8');
    const velvet = kit.velvet('#17151a');
    const pearl = kit.pearl('#f3f6fc');
    const gem = kit.gem('#f3f6fc');
    const env = new Texture();
    kit.bindEnvironment(env);
    for (const material of [metal, velvet, pearl, gem.front, gem.back]) {
      expect(material.envMap).toBe(env);
    }
    expect(metal.envMapIntensity).toBeGreaterThan(velvet.envMapIntensity);
    // Materials created after binding pick the environment up too.
    expect(kit.satin('#a8182f').envMap).toBe(env);

    const spies = [metal, velvet, pearl, gem.front, gem.back].map((m) => vi.spyOn(m, 'dispose'));
    kit.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});
