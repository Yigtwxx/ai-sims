import type { VRM } from '@pixiv/three-vrm';
import { describe, expect, it } from 'vitest';

import { createAccessoryRig } from './rig';

describe('accessory rig contract', () => {
  it('validates selections and is safe to drive and dispose', () => {
    const rig = createAccessoryRig(
      {} as VRM,
      [],
      [
        { id: 'ear-drop-crystal', color: '#cf1f40' },
        { id: 'ear-hoop-large' },
        { id: 'unknown' },
        { id: 'navel-ring' },
      ],
    );
    expect(rig.items.map((item) => [item.def.id, item.color])).toEqual([
      ['ear-drop-crystal', '#cf1f40'],
      ['navel-ring', '#dfe3e8'],
    ]);
    expect(() => {
      rig.update(1 / 60);
      rig.dispose();
    }).not.toThrow();
  });
});
