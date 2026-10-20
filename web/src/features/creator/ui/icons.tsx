import type { SVGProps } from 'react';

/** Hand-drawn 20px line icons shared by the creator controls (stroke follows currentColor). */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const UndoIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M7.5 5 4 8.5 7.5 12" />
    <path d="M4.5 8.5h7a4.5 4.5 0 0 1 0 9H9" />
  </Icon>
);

export const RedoIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12.5 5 16 8.5 12.5 12" />
    <path d="M15.5 8.5h-7a4.5 4.5 0 0 0 0 9H11" />
  </Icon>
);

export const ShuffleIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 6h2.6c1.4 0 2.6.7 3.4 1.9l2 3.2c.8 1.2 2 1.9 3.4 1.9H17" />
    <path d="M3 13h2.6c.9 0 1.7-.3 2.4-.9" />
    <path d="M12 7.9c.7-.6 1.5-.9 2.4-.9H17" />
    <path d="m15 4.5 2 2-2 2M15 11.5l2 2-2 2" />
  </Icon>
);

export const ChevronIcon = ({
  direction = 'right',
  ...p
}: SVGProps<SVGSVGElement> & { direction?: 'left' | 'right' }) => (
  <Icon {...p}>
    <path d={direction === 'right' ? 'm8 5 5 5-5 5' : 'm12 5-5 5 5 5'} />
  </Icon>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon strokeWidth={2.2} {...p}>
    <path d="m5 10.5 3.2 3L15 6.5" />
  </Icon>
);

export const RotateIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3.5 10a6.5 3 0 0 0 13 0" />
    <path d="M16.5 10a6.5 3 0 0 0-11.7-1.8" />
    <path d="m3.5 5.5 1.3 2.7 2.9-.8" />
  </Icon>
);

export const ArrowLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M16 10H4.5M9 5 4 10l5 5" />
  </Icon>
);
