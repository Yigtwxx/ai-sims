import { describe, expect, it } from 'vitest';

import { densityFiles, paintedSlots } from './groomDensity';

const wear = (
  slot: 'hair' | 'eyebrows' | 'beard' | 'mustache',
  textures: Record<string, string>,
) => ({
  groom: { slot, textures },
});

describe('densityFiles', () => {
  it('takes the smooth density for hair and facial hair, the strand detail for brows', () => {
    const files = densityFiles([
      wear('hair', { baked: 'hair/baked.ktx2', density: 'hair/density.ktx2' }),
      wear('eyebrows', { baked: 'brows/baked.ktx2', density: 'brows/density.ktx2' }),
      wear('beard', { density: 'beard/density.ktx2' }),
    ]);
    expect(files).toEqual(['hair/density.ktx2', 'brows/baked.ktx2', 'beard/density.ktx2', null]);
  });

  it('takes the map of a painted groom and marks its slot', () => {
    const wears = [
      wear('hair', { baked: 'hair/baked.ktx2', density: 'hair/density.ktx2' }),
      {
        groom: {
          slot: 'beard' as const,
          textures: { baked: 'stubble/baked.ktx2' },
          painted: 'stubble/baked.ktx2',
        },
      },
    ];
    expect(densityFiles(wears)).toEqual(['hair/density.ktx2', null, 'stubble/baked.ktx2', null]);
    expect(paintedSlots(wears)).toEqual([false, false, true, false]);
  });

  it('falls back to whichever map a groom has', () => {
    expect(densityFiles([wear('hair', { baked: 'hair/baked.ktx2' })])[0]).toBe('hair/baked.ktx2');
    expect(densityFiles([wear('eyebrows', { density: 'b/density.ktx2' })])[1]).toBe(
      'b/density.ktx2',
    );
    expect(densityFiles([wear('mustache', { attribute: 'm/attribute.ktx2' })])[3]).toBeNull();
  });
});
