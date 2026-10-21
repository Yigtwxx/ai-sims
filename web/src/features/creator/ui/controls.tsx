'use client';

import { CheckIcon, ProhibitIcon } from '@phosphor-icons/react';
import { useId, type ReactNode } from 'react';

import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

import { useCreatorStore } from '../store';

const endGesture = () => useCreatorStore.getState().endGesture();

/** A titled block inside a category: more space above than below. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-3 pt-7 first:pt-1', className)}>
      <header className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-ui text-ink font-semibold">
          {title}
        </h3>
        {aside ? <span className="text-label text-ink-faint tabular-nums">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** Quiet explanatory line under a control. */
export function Hint({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'alert';
}) {
  return (
    <p
      className={cn('text-label leading-snug', tone === 'alert' ? 'text-alert' : 'text-ink-faint')}
    >
      {children}
    </p>
  );
}

interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Words at the two ends of the track ("Kısa" / "Uzun"). */
  ends?: [string, string];
  /** Human readout of the value, also used as aria-valuetext. */
  valueText: string;
  centered?: boolean;
  disabled?: boolean;
  /** Extra content beside the value (a colour preview). */
  adornment?: ReactNode;
}

export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  ends,
  valueText,
  centered,
  disabled,
  adornment,
}: LabeledSliderProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <label id={id} className="text-label text-ink-muted font-medium">
          {label}
        </label>
        <span className="text-label text-ink flex items-center gap-2 tabular-nums">
          {adornment}
          {valueText}
        </span>
      </div>
      <Slider
        aria-labelledby={id}
        aria-valuetext={valueText}
        value={[value]}
        min={min}
        max={max}
        step={step}
        centered={centered}
        disabled={disabled}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next);
        }}
        // A drag is one undo step, not one per pointer move.
        onPointerDown={() => useCreatorStore.getState().beginGesture()}
        onPointerUp={endGesture}
        onLostPointerCapture={endGesture}
        onValueCommit={endGesture}
      />
      {ends ? (
        <div className="text-label text-ink-faint flex justify-between" aria-hidden="true">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      ) : null}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}

/** A radio group drawn as one segmented bar. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('rounded-control border-hairline bg-backstage flex border p-0.5', className)}
      onKeyDown={(event) => {
        const index = options.findIndex((option) => option.value === value);
        const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        event.preventDefault();
        const next = options[(index + delta + options.length) % options.length];
        onChange(next.value);
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
        buttons[options.indexOf(next)]?.focus();
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-tile text-ui h-9 min-w-0 flex-1 truncate px-3 transition-colors duration-200',
              active ? 'bg-backstage-lift text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SwatchOption {
  /** What is selected and reported: a colour, or an id (tint presets). */
  value: string;
  label: string;
  /** CSS fill when `value` is not a colour; null draws a neutral swatch. */
  swatch?: string | null;
}

interface SwatchPickerProps {
  label: string;
  colors: readonly SwatchOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Label of the leading "none" swatch; omit to hide it. */
  noneLabel?: string;
  size?: 'sm' | 'md';
  /** Draw swatches as small irises. */
  iris?: boolean;
}

/** Circular colour radios, with an optional leading "none". */
export function SwatchPicker({
  label,
  colors,
  value,
  onChange,
  noneLabel,
  size = 'md',
  iris = false,
}: SwatchPickerProps) {
  const dimension = size === 'sm' ? 'size-8' : 'size-10';
  const swatch = (selected: boolean) =>
    cn(
      'relative flex shrink-0 items-center justify-center rounded-full ring-offset-[3px] ring-offset-backstage transition-[box-shadow,transform] duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-marquee',
      dimension,
      selected ? 'ring-2 ring-marquee' : 'ring-1 ring-hairline',
    );

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2.5">
      {noneLabel ? (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label={noneLabel}
          title={noneLabel}
          onClick={() => onChange(null)}
          className={cn(swatch(value === null), 'bg-backstage-raised text-ink-faint')}
        >
          <ProhibitIcon className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {colors.map((color) => {
        const selected = value?.toLowerCase() === color.value.toLowerCase();
        const fill = color.swatch === undefined ? color.value : color.swatch;
        return (
          <button
            key={color.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color.label}
            title={color.label}
            onClick={() => onChange(color.value)}
            className={swatch(selected)}
            style={{
              background:
                fill === null
                  ? 'repeating-linear-gradient(135deg, var(--color-backstage-lift) 0 4px, var(--color-backstage-raised) 4px 8px)'
                  : iris
                    ? `radial-gradient(circle, rgb(8 7 7) 0 21%, ${fill} 25%, ${fill} 56%, rgb(16 13 10) 70%)`
                    : fill,
            }}
          >
            {selected && !iris ? (
              <CheckIcon
                weight="bold"
                aria-hidden="true"
                className="text-ink size-3.5 mix-blend-difference"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface ChipRadioProps<T extends string> {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}

/** Wrapping chips for choices with longer or many labels. */
export function ChipRadio<T extends string>({
  label,
  value,
  options,
  onChange,
}: ChipRadioProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-tile text-ui h-9 border px-3.5 transition-colors duration-200 disabled:opacity-40',
              active
                ? 'border-marquee bg-backstage-lift text-ink'
                : 'border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
