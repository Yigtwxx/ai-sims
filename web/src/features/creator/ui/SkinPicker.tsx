'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

import { groupByToneBand, stageSwatchBackground, type ToneBand } from '../skinSwatch';

import { SlidingIndicator } from './controls';
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

const RING = '-inset-[5px] rounded-full shadow-[inset_0_0_0_2px_var(--color-marquee)]';

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
          <p aria-hidden="true" className="text-label text-ink-faint">
            {bandLabels[band]}
          </p>
          <div className="stagger-in grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-x-1 gap-y-3">
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
                  className="group/skin flex min-w-0 flex-col items-center gap-2 pt-1.5 outline-none"
                >
                  <span
                    className={cn(
                      'ease-out-expo group-focus-visible/skin:outline-marquee relative block size-10 shrink-0 rounded-full transition-[scale,box-shadow] duration-300 group-hover/skin:scale-105 group-focus-visible/skin:outline-2 group-focus-visible/skin:outline-offset-[6px] group-active/skin:scale-95 group-active/skin:duration-100',
                      selected ? 'ring-0' : 'ring-hairline ring-1',
                    )}
                    style={{ background: stageSwatchBackground(option.swatch) }}
                  >
                    {selected ? <SlidingIndicator layoutId={ringId} className={RING} /> : null}
                  </span>
                  <span
                    className={cn(
                      'text-label max-w-full truncate leading-tight transition-colors duration-200',
                      selected
                        ? 'text-ink font-medium'
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
