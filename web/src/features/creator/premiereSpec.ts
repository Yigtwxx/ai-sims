import { labelFor, type MhManifest } from '@/lib/assets/manifest';
import type { CharacterConfig } from '@/lib/character/schema';

export interface PremiereSpec {
  /** The face preset's label, when the manifest knows it. */
  face?: string;
  /** The hairstyle's label; none when the character has no hair. */
  hair?: string;
  /** Garments worn (top, bottom, shoes, one-piece). */
  garments: number;
}

/**
 * The few facts the premiere card states about a finished character, read
 * from its config with the manifest's own labels. Parts the manifest cannot
 * name are left out rather than shown as ids.
 */
export function premiereSpec(
  config: CharacterConfig,
  manifest: MhManifest,
  locale: string,
): PremiereSpec {
  const face = manifest.faces.find((item) => item.id === config.face.preset);
  const hair = config.hair.style
    ? manifest.grooms.find((groom) => groom.id === config.hair.style)
    : undefined;
  const { top, bottom, shoes, full } = config.outfit;
  return {
    face: face ? labelFor(face.label, locale) : undefined,
    hair: hair ? labelFor(hair.label, locale) : undefined,
    garments: [top, bottom, shoes, full].filter(Boolean).length,
  };
}
