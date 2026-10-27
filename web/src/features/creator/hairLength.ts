export const HAIR_LENGTHS = ['short', 'medium', 'long'] as const;
export type HairLength = (typeof HAIR_LENGTHS)[number];

const CODES: Record<string, HairLength> = { S: 'short', M: 'medium', L: 'long' };

/**
 * A hairstyle's length from its MetaHuman groom name, the part after the last
 * '.' of the manifest id: `Hair_S_…` short, `Hair_M_…` medium, `Hair_L_…`
 * long. Grooms named any other way (the fixture's, a custom export) have no
 * known length.
 */
export function hairLength(id: string): HairLength | undefined {
  const name = id.slice(id.lastIndexOf('.') + 1);
  const code = /^Hair_([SML])_/.exec(name)?.[1];
  return code ? CODES[code] : undefined;
}
