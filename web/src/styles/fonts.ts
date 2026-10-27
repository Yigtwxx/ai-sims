import { Azeret_Mono, Geologica } from 'next/font/google';

/**
 * Typography (see /DESIGN.md, "Paper and Ink"): Geologica for everything people
 * read, Azeret Mono for kickers, readouts and keyboard hints. Both are variable,
 * ship latin-ext for Turkish (ç ğ ı İ ö ş ü) and are self-hosted by next/font.
 */
export const sansFont = Geologica({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans-face',
  display: 'swap',
});

export const monoFont = Azeret_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-mono-face',
  display: 'swap',
});

/** Apply to <html> so the CSS variables are available everywhere. */
export const fontVariables = `${sansFont.variable} ${monoFont.variable}`;
