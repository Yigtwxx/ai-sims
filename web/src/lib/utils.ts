import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge needs to know the project's custom type-ramp utilities
 * (globals.css `--text-*`), otherwise `text-ui` and `text-ink` look like the
 * same group and one of them is dropped.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'kicker',
        'label',
        'ui',
        'body-sm',
        'body',
        'title',
        'subhead',
        'lede',
        'headline',
        'display',
      ],
      radius: ['tile', 'control'],
    },
  },
});

/** Merge class names, letting later Tailwind utilities win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
