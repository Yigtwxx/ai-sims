'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

import { groupByToneBand, stageSwatchBackground, type ToneBand } from '../skinSwatch';

import { SlidingIndicator, SWATCH_RING } from './controls';
import { onGridKeyDown } from './OptionGrid';

export interface SkinOption {
  id: string;
  label: string;
  /** Manifest albedo swatch; drawn as the skin looks on stage. */
  swatch: string;
  /** 0 (lightest) .. 1 (darkest). */
  tone: number;
}

interface SkinPickerProps {
  label: string;
  bandLabels: Record<ToneBand, string>;
  /** Lightest first. */
  options: readonly SkinOption[];
  value: string | null;
  onChange: (id: string) => void;
}

/**
 * Skin sets as named, lit swatches in light / medium / deep bands. Neighbouring
 * presets can share an average colour and differ only in texture, so every
 * swatch carries its name; the swatch itself is the stage-lit skin, not the
 * flat albedo. One radiogroup: arrow keys move across the bands.
 */
export function SkinPicker({ label, bandLabels, options, value, onChange }: SkinPickerProps) {
  const ringId = `skin-ring-${useId()}`;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onGridKeyDown}
      className="flex flex-col gap-4"
    >
      {groupByToneBand(options).map(({ band, items }) => (
        <div key={band} role="group" aria-label={bandLabels[band]} className="flex flex-col gap-2">
          <p
            aria-hidden="true"
            className="text-ink-faint font-mono text-[11px] tracking-[0.1em] uppercase"
          >
            {bandLabels[band]}
          </p>
          <div className="stagger-in grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-x-1 gap-y-3">
            {items.map((option) => {
              const selected = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  onClick={() => onChange(option.id)}
                  className="group/skin flex min-w-0 flex-col items-center gap-2 pt-1 outline-none"
                >
                  <span
                    className="ease-out-expo group-focus-visible/skin:outline-cobalt relative block size-[30px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(23_26_33/0.12)] transition-[scale] duration-300 group-hover/skin:scale-[1.06] group-focus-visible/skin:outline-2 group-focus-visible/skin:outline-offset-[5px] group-active/skin:scale-95 group-active/skin:duration-100"
                    style={{ background: stageSwatchBackground(option.swatch) }}
                  >
                    {selected ? (
                      <SlidingIndicator layoutId={ringId} className={SWATCH_RING} />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'text-label max-w-full truncate leading-tight transition-colors duration-200',
                      selected
                        ? 'text-ink font-semibold'
                        : 'text-ink-muted group-hover/skin:text-ink',
                    )}
                  >
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
