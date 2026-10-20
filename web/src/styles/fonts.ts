import { Mona_Sans } from 'next/font/google';

/**
 * Typography (see /DESIGN.md, "The Lit Stage"): one family, Mona Sans, at two
 * widths. Display type is expanded and tightly tracked like a title card; UI
 * type stays at normal width. The variable font carries both axes (wght, wdth)
 * and ships latin-ext for Turkish (ç ğ ı İ ö ş ü). Self-hosted by next/font.
 */
export const sansFont = Mona_Sans({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--font-sans-face',
  display: 'swap',
});

/** Apply to <html> so the CSS variables are available everywhere. */
export const fontVariables = sansFont.variable;
