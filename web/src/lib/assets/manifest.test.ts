import { describe, expect, it } from 'vitest';

import {
  applyCuration,
  assetUrl,
  CurationSchema,
  labelFor,
  MhManifestSchema,
  type MhManifest,
} from './manifest';

const minimal = {
  version: 2,
  generatedAt: '2026-10-20T20:00:00Z',
  faces: [
    { id: 'Ada', label: 'Ada', gender: 'female', head: 'faces/Ada/head.glb', defaultSkin: 'Ada' },
    {
      id: 'Bruce',
      label: 'Bruce',
      gender: 'male',
      head: 'faces/Bruce/head.glb',
      defaultSkin: 'Bruce',
    },
  ],
  skins: [
    {
      id: 'Ada',
      label: 'Ada',
      tone: 0.3,
      swatch: '#c89f86',
      face: { albedo: 'skins/Ada/face_albedo.ktx2', normal: 'skins/Ada/face_normal.ktx2' },
      body: { albedo: 'skins/Ada/body_albedo.ktx2', normal: 'skins/Ada/body_normal.ktx2' },
    },
  ],
  bodies: [
    {
      gender: 'female',
      glb: 'bodies/female/body.glb',
      sliders: [{ id: 'height', min: -1, max: 1, default: 0 }],
      presets: { average: { height: 0 } },
    },
  ],
};

describe('MhManifestSchema', () => {
  it('accepts a minimal manifest and fills list defaults', () => {
    const parsed = MhManifestSchema.parse(minimal);
    expect(parsed.grooms).toEqual([]);
    expect(parsed.skins[0].face.wrinkleColor).toEqual([]);
  });

  it('rejects ids that are not file-safe', () => {
    const bad = { ...minimal, faces: [{ ...minimal.faces[0], id: '../evil' }] };
    expect(MhManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown manifest version', () => {
    expect(MhManifestSchema.safeParse({ ...minimal, version: 1 }).success).toBe(false);
  });
});

describe('applyCuration', () => {
  it('hides curated ids and keeps the rest', () => {
    const manifest: MhManifest = MhManifestSchema.parse(minimal);
    const curated = applyCuration(manifest, { hidden: ['Bruce'] });
    expect(curated.faces.map((face) => face.id)).toEqual(['Ada']);
    expect(curated.skins).toHaveLength(1);
  });
});

describe('CurationSchema', () => {
  const pick = {
    keep: 'groom.eyebrows.Eyebrows_M_SlightArch',
    keepLabel: 'Medium Slight Arch Eyebrows',
    distance: 0.31,
    unit: 'mm',
  };

  it('reads a file written before the pre-pass existed', () => {
    expect(CurationSchema.parse({ hidden: ['Bruce'] })).toEqual({ hidden: ['Bruce'], auto: {} });
    expect(CurationSchema.parse({})).toEqual({ hidden: [], auto: {} });
  });

  it('keeps the pre-pass picks', () => {
    const curation = CurationSchema.parse({
      hidden: ['groom.eyebrows.Eyebrows_M_Thin'],
      auto: {
        'groom.eyebrows.Eyebrows_M_Thin': pick,
        'anim.Idle_02': { ...pick, keep: 'anim.Idle_01', unit: 'deg' },
      },
    });
    expect(curation.auto['groom.eyebrows.Eyebrows_M_Thin']).toEqual(pick);
    expect(curation.auto['anim.Idle_02']?.unit).toBe('deg');
  });

  it('refuses a pick with an unknown unit or a missing field', () => {
    expect(CurationSchema.safeParse({ auto: { a: { ...pick, unit: 'cm' } } }).success).toBe(false);
    expect(CurationSchema.safeParse({ auto: { a: { keep: 'b' } } }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('builds asset urls under the asset root', () => {
    expect(assetUrl('faces/Ada/head.glb')).toBe('/assets/mh/faces/Ada/head.glb');
    expect(assetUrl('/faces/Ada/head.glb')).toBe('/assets/mh/faces/Ada/head.glb');
  });

  it('picks a localized label', () => {
    expect(labelFor({ tr: 'Kot', en: 'Jeans' }, 'tr')).toBe('Kot');
    expect(labelFor('Ada', 'en')).toBe('Ada');
  });
});
