import { describe, expect, it } from 'vitest';

import { labelFor } from '@/lib/assets/manifest';

import { fixtureManifest } from './fixtures/manifest';
import { premiereSpec } from './premiereSpec';
import { outfitsFor, startingConfig } from './reconcile';

const manifest = fixtureManifest();

describe('premiereSpec', () => {
  it('names the face and hairstyle with the manifest labels', () => {
    const config = startingConfig('female', manifest);
    const face = manifest.faces.find((item) => item.id === config.face.preset)!;
    const spec = premiereSpec(config, manifest, 'tr');
    expect(spec.face).toBe(labelFor(face.label, 'tr'));
    if (config.hair.style) {
      const hair = manifest.grooms.find((groom) => groom.id === config.hair.style)!;
      expect(spec.hair).toBe(labelFor(hair.label, 'tr'));
    }
  });

  it('leaves out hair when there is none and counts the garments worn', () => {
    const config = structuredClone(startingConfig('female', manifest));
    config.hair.style = null;
    const top = outfitsFor(manifest, 'top', 'female')[0]!;
    const shoes = outfitsFor(manifest, 'shoes', 'female')[0]!;
    config.outfit = {
      top: { id: top.id, tint: null, colors: {} },
      bottom: null,
      shoes: { id: shoes.id, tint: null, colors: {} },
      full: null,
    };
    const spec = premiereSpec(config, manifest, 'en');
    expect(spec.hair).toBeUndefined();
    expect(spec.garments).toBe(2);
  });

  it('never shows an id the manifest cannot name', () => {
    const config = structuredClone(startingConfig('female', manifest));
    config.face.preset = 'face.unknown';
    config.hair.style = 'groom.hair.Unknown';
    const spec = premiereSpec(config, manifest, 'tr');
    expect(spec.face).toBeUndefined();
    expect(spec.hair).toBeUndefined();
  });
});
