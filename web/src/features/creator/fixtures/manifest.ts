/**
 * Development fixture for the MetaHuman manifest, used only with `?fixture=1`
 * in development while the real export (`/assets/mh/manifest.json`) is not on
 * this machine. Ids follow the pipeline's conventions; thumbnails are
 * generated SVG placeholders (data URLs), never pictures of people. File
 * paths point at assets that do not exist, so the stage shows its empty studio.
 */
import { MhManifestSchema, type MhManifest } from '@/lib/assets/manifest';

type Gender = 'female' | 'male';

const svg = (body: string, width = 300, height = 400) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  )}`;

/** A lit 3:4 poster tinted by the preset's skin tone, with its name: a rendered thumbnail stands in later. */
function facePoster(name: string, skin: string): string {
  return svg(
    `<defs><radialGradient id="l" cx="50%" cy="34%" r="72%"><stop offset="0" stop-color="${skin}" stop-opacity="0.55"/><stop offset="0.55" stop-color="#1a1714"/><stop offset="1" stop-color="#0b0b0a"/></radialGradient></defs>` +
      `<rect width="300" height="400" fill="url(#l)"/>` +
      `<text x="150" y="214" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="120" font-weight="600" fill="#f3efe8" opacity="0.14">${name.slice(0, 1)}</text>`,
  );
}

/** Strand texture in a natural hair colour, with a shape hint per style. */
function groomPoster(color: string, shape: 'long' | 'short' | 'up' | 'beard' | 'brow'): string {
  const strands = `<pattern id="p" width="7" height="400" patternUnits="userSpaceOnUse"><rect width="7" height="400" fill="${color}"/><rect x="2" width="1.2" height="400" fill="#ffffff" opacity="0.12"/><rect x="5" width="1" height="400" fill="#000000" opacity="0.18"/></pattern>`;
  const shapes = {
    long: '<path d="M70 90 Q150 20 230 90 L250 360 Q150 390 50 360 Z" fill="url(#p)"/>',
    short: '<path d="M80 120 Q150 40 220 120 L224 210 Q150 170 76 210 Z" fill="url(#p)"/>',
    up: '<ellipse cx="150" cy="132" rx="52" ry="40" fill="url(#p)"/><path d="M78 210 Q150 120 222 210 L226 250 Q150 222 74 250 Z" fill="url(#p)"/>',
    beard: '<path d="M90 190 Q150 330 210 190 L200 250 Q150 340 100 250 Z" fill="url(#p)"/>',
    brow: '<path d="M70 170 Q110 140 140 160 L138 172 Q108 158 74 182 Z M230 170 Q190 140 160 160 L162 172 Q192 158 226 182 Z" fill="url(#p)"/>',
  } as const;
  return svg(
    `<defs>${strands}<radialGradient id="l" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#2c261f"/><stop offset="1" stop-color="#0b0b0a"/></radialGradient></defs>` +
      `<rect width="300" height="400" fill="url(#l)"/>${shapes[shape]}`,
  );
}

/** A folded-garment colour block for outfit thumbnails. */
function outfitPoster(primary: string, secondary: string): string {
  return svg(
    `<defs><radialGradient id="l" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#2c261f"/><stop offset="1" stop-color="#0b0b0a"/></radialGradient>` +
      `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs>` +
      `<rect width="300" height="400" fill="url(#l)"/>` +
      `<rect x="62" y="90" width="176" height="200" rx="18" fill="url(#g)"/>` +
      `<rect x="62" y="90" width="176" height="200" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>`,
  );
}

const FACES: { id: string; gender: Gender; skin: string; tone: number }[] = [
  { id: 'Ada', gender: 'female', skin: '#c99c80', tone: 0.34 },
  { id: 'Aera', gender: 'female', skin: '#e2b9a0', tone: 0.18 },
  { id: 'Aoi', gender: 'female', skin: '#e8c4a8', tone: 0.14 },
  { id: 'Danielle', gender: 'female', skin: '#a8704f', tone: 0.55 },
  { id: 'Hana', gender: 'female', skin: '#dcb193', tone: 0.24 },
  { id: 'Valerie', gender: 'female', skin: '#f0cdb6', tone: 0.08 },
  { id: 'Zuri', gender: 'female', skin: '#6e4330', tone: 0.82 },
  { id: 'Malika', gender: 'female', skin: '#8a5a40', tone: 0.68 },
  { id: 'Bruce', gender: 'male', skin: '#d2a284', tone: 0.3 },
  { id: 'Cooper', gender: 'male', skin: '#e6bea2', tone: 0.15 },
  { id: 'Ettore', gender: 'male', skin: '#c48e6c', tone: 0.4 },
  { id: 'Lucian', gender: 'male', skin: '#b67c5a', tone: 0.48 },
  { id: 'Omar', gender: 'male', skin: '#9c6848', tone: 0.6 },
  { id: 'Taro', gender: 'male', skin: '#dcb08e', tone: 0.26 },
  { id: 'Trey', gender: 'male', skin: '#5e3828', tone: 0.88 },
  { id: 'Wallace', gender: 'male', skin: '#e8c2a6', tone: 0.12 },
];

const SLIDERS = ['height', 'weight', 'muscle', 'chest', 'waist', 'hips', 'shoulders'] as const;
const sliders = SLIDERS.map((id) => ({ id, min: -1, max: 1, default: 0 }));

const body = (gender: Gender) => ({
  gender,
  glb: `bodies/${gender}/body.glb`,
  sliders,
  presets: {
    slim: { weight: -0.6, muscle: -0.2, chest: -0.3, waist: -0.4, hips: -0.3, shoulders: -0.2 },
    average: {},
    athletic: { weight: 0.05, muscle: 0.75, chest: 0.3, waist: -0.25, shoulders: 0.45 },
    // Curvy is female only, as the pipeline exports it.
    ...(gender === 'female'
      ? { curvy: { weight: 0.35, chest: 0.55, waist: -0.1, hips: 0.75, shoulders: -0.05 } }
      : {}),
  },
});

const HAIR = [
  { id: 'Hair_BantuKnots', label: 'Bantu Knots', shape: 'up' },
  { id: 'Hair_LongHighPonytail', label: 'Long High Ponytail', shape: 'long' },
  { id: 'Hair_SlickPonytail', label: 'Slick Ponytail', shape: 'up' },
  { id: 'Hair_UpdoCornrows', label: 'Updo Cornrows', shape: 'up' },
  { id: 'Hair_UpdoDutchBraid', label: 'Updo Dutch Braid', shape: 'up' },
  { id: 'Hair_UpdoMessyBun', label: 'Updo Messy Bun', shape: 'up' },
  { id: 'Hair_LongStraight', label: 'Long Straight', shape: 'long' },
  { id: 'Hair_WavyBob', label: 'Wavy Bob', shape: 'short' },
  { id: 'Hair_ShortCrop', label: 'Short Crop', shape: 'short' },
  { id: 'Hair_SidePart', label: 'Side Part', shape: 'short' },
  { id: 'Hair_BuzzCut', label: 'Buzz Cut', shape: 'short' },
  { id: 'Hair_CurlyMedium', label: 'Curly Medium', shape: 'long' },
] as const;

const hairParams = [
  { name: 'Melanin', type: 'float', default: 0.75, min: 0, max: 1 },
  { name: 'Redness', type: 'float', default: 0.25, min: 0, max: 1 },
  { name: 'DyeColor', type: 'color', default: '#000000' },
] as const;

const groom = (
  slot: 'hair' | 'eyebrows' | 'beard' | 'mustache',
  id: string,
  label: string,
  shape: 'long' | 'short' | 'up' | 'beard' | 'brow',
  compat: 'female' | 'male' | 'unisex' = 'unisex',
) => ({
  id,
  slot,
  label,
  compat,
  glb: `grooms/${slot}/${id}/cards.glb`,
  thumbnail: groomPoster('#4a3121', shape),
  params: [...hairParams],
});

const OUTFIT_COLOR_PARAMS = [
  { name: 'PrimaryColor', type: 'color', default: '#3a3f47' },
  { name: 'SecondaryColor', type: 'color', default: '#1d1f22' },
] as const;

const outfit = (
  category: 'top' | 'bottom' | 'shoes' | 'full',
  id: string,
  label: { tr: string; en: string },
  tints: { id: string; primary: string; secondary: string; label: { tr: string; en: string } }[],
  compat: 'female' | 'male' | 'unisex' = 'unisex',
) => ({
  id,
  category,
  label,
  compat,
  files: {
    ...(compat !== 'male' ? { female: `outfits/${id}/female.glb` } : {}),
    ...(compat !== 'female' ? { male: `outfits/${id}/male.glb` } : {}),
  },
  thumbnail: outfitPoster(tints[0]?.primary ?? '#3a3f47', tints[0]?.secondary ?? '#1d1f22'),
  params: [...OUTFIT_COLOR_PARAMS],
  tintPresets: tints.map((tint) => ({
    id: tint.id,
    label: tint.label,
    values: { PrimaryColor: tint.primary, SecondaryColor: tint.secondary },
  })),
  hidesBodyRegions: category === 'full' ? ['torso', 'legs'] : [],
});

const tint = (id: string, tr: string, en: string, primary: string, secondary: string) => ({
  id,
  label: { tr, en },
  primary,
  secondary,
});

const IRISES = [
  ['Iris_DarkBrown', 'Dark brown', '#3b2617'],
  ['Iris_Brown', 'Brown', '#5b3a22'],
  ['Iris_Hazel', 'Hazel', '#7b6a3b'],
  ['Iris_Amber', 'Amber', '#a3712d'],
  ['Iris_Green', 'Green', '#5e7b4b'],
  ['Iris_Grey', 'Grey', '#7d8a8f'],
  ['Iris_Blue', 'Blue', '#5f85a9'],
  ['Iris_DeepBlue', 'Deep blue', '#2f4f79'],
] as const;

const raw = {
  version: 2,
  generatedAt: '2026-10-20T21:00:00Z',
  faces: FACES.map((face) => ({
    id: face.id,
    label: face.id,
    gender: face.gender,
    head: `faces/${face.id}/head.glb`,
    thumbnail: facePoster(face.id, face.skin),
    defaultSkin: face.id,
    defaultIris: 'Iris_Hazel',
  })),
  skins: FACES.map((face) => ({
    id: face.id,
    label: face.id,
    tone: face.tone,
    swatch: face.skin,
    face: {
      albedo: `faces/${face.id}/maps/albedo.ktx2`,
      normal: `faces/${face.id}/maps/normal.ktx2`,
    },
    body: {
      albedo: `bodies/${face.gender}/maps/albedo.ktx2`,
      normal: `bodies/${face.gender}/maps/normal.ktx2`,
    },
    ...(face.id === 'Ada' || face.id === 'Zuri' || face.id === 'Valerie'
      ? { makeupAlbedo: `faces/${face.id}/maps/albedo_makeup.ktx2` }
      : {}),
  })),
  bodies: [body('female'), body('male')],
  grooms: [
    ...HAIR.map((hair) => groom('hair', hair.id, hair.label, hair.shape)),
    groom('eyebrows', 'Brows_Natural', 'Natural', 'brow'),
    groom('eyebrows', 'Brows_Thick', 'Thick', 'brow'),
    groom('eyebrows', 'Brows_ThinArch', 'Thin Arch', 'brow'),
    groom('eyebrows', 'Brows_Straight', 'Straight', 'brow'),
    groom('beard', 'Beard_Stubble', 'Stubble', 'beard', 'male'),
    groom('beard', 'Beard_ShortBoxed', 'Short Boxed', 'beard', 'male'),
    groom('beard', 'Beard_Full', 'Full', 'beard', 'male'),
    groom('beard', 'Beard_Goatee', 'Goatee', 'beard', 'male'),
    groom('mustache', 'Mustache_Chevron', 'Chevron', 'beard', 'male'),
    groom('mustache', 'Mustache_Pencil', 'Pencil', 'beard', 'male'),
    groom('mustache', 'Mustache_Handlebar', 'Handlebar', 'beard', 'male'),
  ],
  outfits: [
    outfit('top', 'Top_Hoodie', { tr: 'Kapüşonlu', en: 'Hoodie' }, [
      tint('charcoal', 'Antrasit', 'Charcoal', '#2f3136', '#1c1d20'),
      tint('sand', 'Kum', 'Sand', '#c9b79a', '#9c8a6e'),
      tint('forest', 'Orman', 'Forest', '#2f4a3a', '#1f3328'),
    ]),
    outfit('top', 'Top_TShirt', { tr: 'Tişört', en: 'T-shirt' }, [
      tint('white', 'Beyaz', 'White', '#e9e6df', '#cfcac0'),
      tint('black', 'Siyah', 'Black', '#1b1b1d', '#121214'),
      tint('navy', 'Lacivert', 'Navy', '#22304a', '#172238'),
    ]),
    outfit('top', 'Top_Sweater', { tr: 'Kazak', en: 'Sweater' }, [
      tint('oat', 'Yulaf', 'Oat', '#d6c8ad', '#b5a689'),
      tint('wine', 'Şarap', 'Wine', '#5b2430', '#3e1820'),
    ]),
    outfit('top', 'Top_RolledShirt', { tr: 'Kolları kıvrık gömlek', en: 'Rolled-sleeve shirt' }, [
      tint('chambray', 'Şambre', 'Chambray', '#7d93ad', '#5d7189'),
      tint('white', 'Beyaz', 'White', '#ece9e2', '#d3cfc6'),
    ]),
    outfit(
      'top',
      'Top_CropTop',
      { tr: 'Crop top', en: 'Crop top' },
      [
        tint('black', 'Siyah', 'Black', '#1b1b1d', '#121214'),
        tint('rose', 'Gül', 'Rose', '#c48a8f', '#9c666b'),
      ],
      'female',
    ),
    outfit('bottom', 'Bottom_Jeans', { tr: 'Kot pantolon', en: 'Jeans' }, [
      tint('indigo', 'İndigo', 'Indigo', '#2c3d5c', '#1f2c45'),
      tint('stone', 'Taş', 'Stone', '#7f8da3', '#66738a'),
    ]),
    outfit('bottom', 'Bottom_SlimJeans', { tr: 'Dar kot', en: 'Slim jeans' }, [
      tint('black', 'Siyah', 'Black', '#1d1e22', '#141518'),
    ]),
    outfit('bottom', 'Bottom_Cargo', { tr: 'Kargo pantolon', en: 'Cargo pants' }, [
      tint('olive', 'Haki', 'Olive', '#4b5236', '#363b26'),
      tint('sand', 'Kum', 'Sand', '#b9a684', '#97865f'),
    ]),
    outfit('bottom', 'Bottom_Shorts', { tr: 'Şort', en: 'Shorts' }, [
      tint('khaki', 'Bej', 'Khaki', '#a8996f', '#877a55'),
    ]),
    outfit(
      'bottom',
      'Bottom_YogaPants',
      { tr: 'Tayt', en: 'Yoga pants' },
      [tint('black', 'Siyah', 'Black', '#18181a', '#101012')],
      'female',
    ),
    outfit('shoes', 'Shoes_Chelsea', { tr: 'Chelsea bot', en: 'Chelsea boots' }, [
      tint('brown', 'Kahve', 'Brown', '#4a2f1f', '#2e1d13'),
      tint('black', 'Siyah', 'Black', '#18181a', '#101012'),
    ]),
    outfit('shoes', 'Shoes_Running', { tr: 'Koşu ayakkabısı', en: 'Running shoes' }, [
      tint('white', 'Beyaz', 'White', '#e6e3dc', '#bdb8ae'),
    ]),
    outfit('shoes', 'Shoes_Loafers', { tr: 'Loafer', en: 'Loafers' }, [
      tint('cognac', 'Konyak', 'Cognac', '#7a4223', '#552e18'),
    ]),
    outfit('shoes', 'Shoes_Oxfords', { tr: 'Oxford', en: 'Oxfords' }, [
      tint('black', 'Siyah', 'Black', '#161618', '#0e0e10'),
    ]),
    outfit(
      'shoes',
      'Shoes_Flats',
      { tr: 'Babet', en: 'Flats' },
      [tint('nude', 'Ten', 'Nude', '#c9a48b', '#a6836c')],
      'female',
    ),
    outfit('full', 'Full_Techwear', { tr: 'Teknik giyim takımı', en: 'Techwear outfit' }, [
      tint('graphite', 'Grafit', 'Graphite', '#2a2c30', '#1a1b1e'),
      tint('sage', 'Adaçayı', 'Sage', '#56604f', '#3c4438'),
    ]),
  ],
  irises: IRISES.map(([id, label, swatch]) => ({
    id,
    label,
    color: `irises/${id}/color.ktx2`,
    swatch,
  })),
  animations: [
    { id: 'Idle_Stand', kind: 'body', file: 'animations/idle_stand.glb', tags: ['idle'] },
    { id: 'Idle_Shift', kind: 'body', file: 'animations/idle_shift.glb', tags: ['idle'] },
    { id: 'Talk_Gesture_A', kind: 'body', file: 'animations/talk_a.glb', tags: ['talk'] },
    { id: 'Face_Smile', kind: 'face', file: 'animations/face_smile.json', tags: ['emotion'] },
    { id: 'Face_Think', kind: 'face', file: 'animations/face_think.json', tags: ['emotion'] },
  ],
  lighting: [
    { id: 'Studio', label: 'Studio', file: 'lighting/studio.json' },
    { id: 'Portrait', label: 'Portrait', file: 'lighting/portrait.json' },
  ],
};

let cached: MhManifest | undefined;

/** The validated fixture manifest (development only). */
export function fixtureManifest(): MhManifest {
  cached ??= MhManifestSchema.parse(raw);
  return cached;
}
