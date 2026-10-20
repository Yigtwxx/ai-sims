import { Big_Shoulders, Schibsted_Grotesk } from 'next/font/google';

/**
 * Typography (see /DESIGN.md): Big Shoulders at display optical size carries
 * marquee/poster energy for names and title cards; Schibsted Grotesk is the
 * precise UI workhorse. Both ship latin-ext for Turkish (ç ğ ı İ ö ş ü).
 */
export const displayFont = Big_Shoulders({
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz'],
  variable: '--font-display-face',
  display: 'swap',
  // next/font has no fallback metrics for this family; skip the size-adjusted fallback.
  adjustFontFallback: false,
});

export const sansFont = Schibsted_Grotesk({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans-face',
  display: 'swap',
});

/** Apply to <html> so the CSS variables are available everywhere. */
export const fontVariables = `${displayFont.variable} ${sansFont.variable}`;
