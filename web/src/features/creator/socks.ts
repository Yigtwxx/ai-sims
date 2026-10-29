import type { CharacterConfig, SockStyle } from '@/lib/character/schema';

import { SOCK_COLORS, TIGHTS_COLORS, type NamedColor } from './palettes';

type Socks = CharacterConfig['socks'];

/** The colours a sock length offers. */
export const sockPalette = (style: SockStyle): readonly NamedColor[] =>
  style === 'tights' ? TIGHTS_COLORS : SOCK_COLORS;

/**
 * The socks in another length. A colour the new length does not offer (navy
 * socks are not navy tights) falls back to its first; sheerness stays for
 * the next time tights go on.
 */
export function restyleSocks(socks: Socks, style: SockStyle): Socks {
  const offered = sockPalette(style);
  const keeps = offered.some((option) => option.value === socks.color);
  return { ...socks, style, color: keeps ? socks.color : offered[0]!.value };
}
