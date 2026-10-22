/** Message keys (under `Creator.outfit.params`) for the garment colour slots. */
export type ColorParamKey = 'PrimaryColor' | 'SecondaryColor' | 'DetailColor' | 'AccentColor';

// The fabric shader's slots: A layer main and stitch colours, B layer, C layer (laces, trims).
const KEYS: Record<string, ColorParamKey> = {
  PrimaryColor: 'PrimaryColor',
  SecondaryColor: 'SecondaryColor',
  diffuse_color_1: 'PrimaryColor',
  diffuse_color_2: 'SecondaryColor',
  B_diffuse_color_1: 'DetailColor',
  C_color: 'AccentColor',
};

export interface ColorParamLabel {
  key: ColorParamKey | null;
  /** 1-based garment piece when the outfit has several materials (`material.param`), else null. */
  piece: number | null;
}

/**
 * How to label each colour param of one outfit. Multi-material outfits name
 * their params `material.param`; those get a piece number in material order.
 * Unknown params get `key: null` so the caller can fall back to the raw name.
 */
export function colorParamLabels(names: readonly string[]): ColorParamLabel[] {
  const materials: string[] = [];
  for (const name of names) {
    const dot = name.lastIndexOf('.');
    if (dot > 0 && !materials.includes(name.slice(0, dot))) materials.push(name.slice(0, dot));
  }
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const param = dot > 0 ? name.slice(dot + 1) : name;
    const piece =
      dot > 0 && materials.length > 1 ? materials.indexOf(name.slice(0, dot)) + 1 : null;
    return { key: KEYS[param] ?? null, piece };
  });
}
