'use client';

import { useId } from 'react';

interface HeightSliderProps {
  label: string;
  shortLabel: string;
  tallLabel: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/** Thin track, marquee thumb, tabular readout relative to the authored height. */
export function HeightSlider({
  label,
  shortLabel,
  tallLabel,
  value,
  min,
  max,
  onChange,
}: HeightSliderProps) {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;
  const delta = Math.round((value - 1) * 100);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-ink-muted text-[13px] font-medium">
          {label}
        </label>
        <output htmlFor={id} className="text-ink text-[13px] font-medium tabular-nums">
          {delta > 0 ? `+${delta}` : delta}%
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={0.005}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="[&::-moz-range-thumb]:bg-marquee [&::-webkit-slider-thumb]:bg-marquee h-6 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:-mt-[6.5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(255,181,71,0.18)] [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110"
        style={{
          ['--fill' as string]: `${percent}%`,
          background: `linear-gradient(to right, var(--color-marquee) 0 ${percent}%, var(--color-hairline) ${percent}% 100%) center / 100% 3px no-repeat`,
        }}
      />
      <div className="text-ink-faint flex justify-between text-[12px]">
        <span>{shortLabel}</span>
        <span>{tallLabel}</span>
      </div>
    </div>
  );
}
