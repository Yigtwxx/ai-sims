import { Bodoni_Moda, Schibsted_Grotesk } from 'next/font/google';

/**
 * Typography: a fashion-editorial display serif paired with a crisp grotesk.
 * Both ship latin-ext so Turkish glyphs (ç ğ ı İ ö ş ü) render in-face.
 */
export const displayFont = Bodoni_Moda({
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz'],
  variable: '--font-display-face',
  display: 'swap',
});

export const sansFont = Schibsted_Grotesk({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans-face',
  display: 'swap',
});

/** Apply to <html> so the CSS variables are available everywhere. */
export const fontVariables = `${displayFont.variable} ${sansFont.variable}`;
