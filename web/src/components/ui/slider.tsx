'use client';

import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/*
 * shadcn/ui Slider (new-york), restyled as an instrument: a 2px hairline
 * track, an ink range from the origin and a slim cobalt handle (2×14 px drawn,
 * a 24 px invisible hit area around it). The handle grows a little under the
 * pointer and carries the focus ring. Set `centered` for -1..1 values so the
 * range grows from the middle, which is marked by a short tick. aria-label,
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
        'group/slider relative flex h-6 w-full cursor-pointer touch-none items-center select-none data-[disabled]:cursor-default data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-hairline relative h-0.5 w-full grow overflow-hidden"
      >
        {centered ? (
          <span
            aria-hidden="true"
            className="bg-ink absolute inset-y-0"
            style={{ left: `${Math.min(origin, at)}%`, width: `${Math.abs(at - origin)}%` }}
          />
        ) : (
          <SliderPrimitive.Range data-slot="slider-range" className="bg-ink absolute h-full" />
        )}
      </SliderPrimitive.Track>
      {centered ? (
        <span
          aria-hidden="true"
          className="bg-ink-faint absolute top-1/2 h-2 w-px -translate-y-1/2"
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
          className="bg-cobalt focus-visible:outline-cobalt relative block h-3.5 w-0.5 shrink-0 cursor-grab rounded-full transition-[height,width] duration-200 ease-out group-hover/slider:h-[18px] after:absolute after:-inset-x-[11px] after:-inset-y-[5px] after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-[5px] active:h-5 active:w-[3px] active:cursor-grabbing"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
