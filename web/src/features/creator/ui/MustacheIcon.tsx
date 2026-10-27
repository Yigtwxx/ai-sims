import type { SVGProps } from 'react';

/**
 * A moustache for the "brows and beard" rail tab, which Phosphor does not
 * draw. Same grid and stroke as Phosphor's regular weight (256 units, 16 wide,
 * round joins) so it sits among the other rail glyphs.
 */
export function MustacheIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={16}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      {...props}
    >
      <path d="M128 118c-14-22-50-28-72-10-14 11-20 30-36 26 6 26 46 40 78 22 13-7 22-18 30-22 8 4 17 15 30 22 32 18 72 4 78-22-16 4-22-15-36-26-22-18-58-12-72 10Z" />
    </svg>
  );
}
