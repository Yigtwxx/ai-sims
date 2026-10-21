'use client';

import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/*
 * shadcn/ui Slider (new-york), restyled: a hairline track, an amber range from
 * the origin and an amber thumb with a soft halo on hover and focus. Set
 * `centered` for -1..1 values so the range grows from the middle. aria-label,
 * aria-labelledby and aria-valuetext are applied to the thumb (the element
 * with role="slider"), not the wrapper.
 */
function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  centered = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-valuetext': ariaValueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { centered?: boolean }) {
  const values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min]),
    [value, defaultValue, min],
  );
  const current = values[0] ?? min;
  const span = max - min || 1;
  const origin = centered ? ((0 - min) / span) * 100 : 0;
  const at = ((current - min) / span) * 100;

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      className={cn(
        'relative flex h-6 w-full touch-none items-center select-none data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-hairline relative h-[3px] w-full grow overflow-hidden rounded-full"
      >
        {centered ? (
          <span
            aria-hidden="true"
            className="bg-marquee absolute inset-y-0"
            style={{ left: `${Math.min(origin, at)}%`, width: `${Math.abs(at - origin)}%` }}
          />
        ) : (
          <SliderPrimitive.Range data-slot="slider-range" className="bg-marquee absolute h-full" />
        )}
      </SliderPrimitive.Track>
      {centered ? (
        <span
          aria-hidden="true"
          className="bg-ink-faint absolute top-1/2 h-2.5 w-px -translate-y-1/2"
          style={{ left: `${origin}%` }}
        />
      ) : null}
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          // The thumb is the focusable role="slider": its name and value text belong here.
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-valuetext={ariaValueText}
          className="bg-marquee block size-4 shrink-0 rounded-full shadow-[0_0_0_4px_rgb(255_181_71/0.16)] transition-[box-shadow,scale] duration-200 hover:shadow-[0_0_0_6px_rgb(255_181_71/0.22)] focus-visible:shadow-[0_0_0_6px_rgb(255_181_71/0.3)] focus-visible:outline-none active:scale-110"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
