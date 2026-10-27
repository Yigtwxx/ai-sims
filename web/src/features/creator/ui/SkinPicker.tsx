'use client';

import { useId } from 'react';

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
 * Skin sets as lit swatches in light / medium / deep bands. The swatch is the
 * stage-lit skin, not the flat albedo; names stay with screen readers only.
 * One radiogroup: arrow keys move across the bands.
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
          <div className="stagger-in flex flex-wrap gap-2.5">
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
                  className="group/skin outline-none"
                >
                  <span
                    className="ease-out-expo group-focus-visible/skin:outline-cobalt relative block size-[30px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(23_26_33/0.12)] transition-[scale] duration-300 group-hover/skin:scale-[1.06] group-focus-visible/skin:outline-2 group-focus-visible/skin:outline-offset-[5px] group-active/skin:scale-95 group-active/skin:duration-100"
                    style={{ background: stageSwatchBackground(option.swatch) }}
                  >
                    {selected ? (
                      <SlidingIndicator layoutId={ringId} className={SWATCH_RING} />
                    ) : null}
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
