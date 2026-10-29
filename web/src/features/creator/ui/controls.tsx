'use client';

import { ProhibitIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { memo, useId, type KeyboardEvent, type ReactNode } from 'react';

import { SPRING_SNAP } from '@/components/motion/tokens';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

import { useCreatorStore } from '../store';

const endGesture = () => useCreatorStore.getState().endGesture();

/**
 * The highlight that slides to the picked option (Motion shared layout). Its
 * only props are constant strings and it is memoised, so a panel that
 * re-renders on every slider tick never re-renders it: Motion measures layout
 * only when the pick itself moves the indicator.
 */
export const SlidingIndicator = memo(function SlidingIndicator({
  layoutId,
  className,
}: {
  layoutId: string;
  className: string;
}) {
  return (
    <motion.span
      aria-hidden="true"
      layoutId={layoutId}
      transition={SPRING_SNAP}
      className={cn('pointer-events-none absolute', className)}
    />
  );
});

/**
 * A titled block inside a category: a mono kicker with its count or current
 * value on the right ("SAÇ MODELİ · 24"), more space above than below.
 */
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
    <section aria-labelledby={id} className={cn('flex flex-col gap-3 pt-8 first:pt-0', className)}>
      <header className="flex min-h-4 items-baseline justify-between gap-3">
        <h3 id={id} className="text-kicker text-ink-faint">
          {title}
        </h3>
        {aside !== undefined && aside !== null ? (
          <span className="text-kicker text-ink-faint min-w-0 truncate tabular-nums">{aside}</span>
        ) : null}
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
  /** The value where a drag or key press ends, for changes too costly to apply on every step. */
  onCommit?: (value: number) => void;
  /** Words at the two ends of the track ("Kısa" / "Uzun"). */
  ends?: [string, string];
  /** Human readout of the value, also used as aria-valuetext. */
  valueText: string;
  centered?: boolean;
  disabled?: boolean;
  /** Extra content beside the value (a colour preview). */
  adornment?: ReactNode;
  /**
   * The section title already names this slider: keep the label for screen
   * readers only and drop the value column (the section shows it instead).
   */
  labelHidden?: boolean;
  /** Shown in the name column in place of the label (a face thumbnail); the label stays for screen readers. */
  lead?: ReactNode;
}

/**
 * One measured row, like a channel on a mixing desk: the name, the track and
 * the reading in a fixed mono column, so a column of sliders lines up.
 */
export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  onCommit,
  ends,
  valueText,
  centered,
  disabled,
  adornment,
  labelHidden = false,
  lead,
}: LabeledSliderProps) {
  const id = useId();
  const slider = (
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
      onValueCommit={([next]) => {
        if (next !== undefined) onCommit?.(next);
        endGesture();
      }}
    />
  );
  // Pulled up to the track: the ends belong to this slider, not the next row.
  const endWords = ends ? (
    <div
      className="text-ink-faint -mt-1 flex justify-between text-[11px] leading-tight"
      aria-hidden="true"
    >
      <span>{ends[0]}</span>
      <span>{ends[1]}</span>
    </div>
  ) : null;

  if (labelHidden) {
    return (
      <div className="flex flex-col">
        <label id={id} className="sr-only">
          {label}
        </label>
        {slider}
        {endWords}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,5.25rem)_minmax(0,1fr)_3.75rem] items-center gap-x-3.5">
      {lead ? (
        <div className="flex items-center">
          <label id={id} className="sr-only">
            {label}
          </label>
          {lead}
        </div>
      ) : (
        <label id={id} className="text-label text-ink-muted leading-tight">
          {label}
        </label>
      )}
      {slider}
      <span className="text-ink flex items-center justify-end gap-1.5 font-mono text-[12px] tabular-nums">
        {adornment}
        {valueText}
      </span>
      {endWords ? <div className="col-start-2">{endWords}</div> : null}
    </div>
  );
}

interface PillOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Pill segments in a hairline capsule; the picked one is an ink pill that
 * slides between them. `mono` sets the labels as small tracked capitals (stage
 * and filter controls); the default is the UI face (choices in a panel).
 */
function pillClasses(active: boolean, mono: boolean) {
  return cn(
    'relative min-w-0 rounded-full whitespace-nowrap transition-[color,scale] duration-200 active:scale-[0.97] active:duration-100 focus-visible:outline-offset-1 disabled:opacity-40',
    mono ? 'h-7 px-3 font-mono text-[11px] tracking-[0.1em] uppercase' : 'text-ui h-8 px-3.5',
    active ? 'text-paper' : 'text-ink-muted hover:text-ink',
  );
}

const PILL_FILL = 'inset-0 rounded-full bg-ink';
const PILL_BAR = 'border-ink/15 flex rounded-full border p-[3px]';

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly PillOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  mono?: boolean;
}

/** A radio group drawn as one segmented pill bar; arrow keys move the pick. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  mono = false,
}: SegmentedProps<T>) {
  const indicator = `segment-${useId()}`;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.value === value);
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[options.indexOf(next)]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(PILL_BAR, className)}
      onKeyDown={onKeyDown}
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
            className={cn(pillClasses(active, mono), 'flex-1')}
          >
            {active ? <SlidingIndicator layoutId={indicator} className={PILL_FILL} /> : null}
            <span className="relative block truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface PressedPillsProps<T extends string> {
  label: string;
  /** The pressed option; null when none is. */
  value: T | null;
  options: readonly PillOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  mono?: boolean;
}

/**
 * The same pill bar as toggle buttons (aria-pressed) for things that are not a
 * value of the character: camera framings, list filters. Each pill is its own
 * tab stop, like any row of buttons.
 */
export function PressedPills<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  mono = true,
}: PressedPillsProps<T>) {
  const indicator = `pressed-${useId()}`;
  return (
    <div role="group" aria-label={label} className={cn(PILL_BAR, className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={pillClasses(active, mono)}
          >
            {active ? <SlidingIndicator layoutId={indicator} className={PILL_FILL} /> : null}
            <span className="relative block truncate">{option.label}</span>
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

/** The ink ring around a picked swatch, with a paper gap so it never touches the colour. */
export const SWATCH_RING = '-inset-1 rounded-full shadow-[inset_0_0_0_2px_var(--color-ink)]';

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
  const indicator = `swatch-${useId()}`;
  const dimension = size === 'sm' ? 'size-7' : 'size-[30px]';
  const swatch = cn(
    'relative flex shrink-0 items-center justify-center rounded-full transition-[scale] duration-200 hover:scale-[1.06] active:scale-95 active:duration-100 focus-visible:outline-offset-[5px]',
    dimension,
  );
  // The ring travels between swatches.
  const ring = <SlidingIndicator layoutId={indicator} className={SWATCH_RING} />;
  // A hairline inside the edge keeps pale colours off the paper.
  const edge = (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgb(23_26_33/0.12)]"
    />
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
          className={cn(swatch, 'bg-paper text-ink-faint')}
        >
          {value === null ? ring : null}
          {edge}
          <ProhibitIcon className="size-4" weight="light" aria-hidden="true" />
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
            className={swatch}
            style={{
              background:
                fill === null
                  ? 'repeating-linear-gradient(135deg, var(--color-paper-lift) 0 4px, var(--color-paper-raised) 4px 8px)'
                  : iris
                    ? `radial-gradient(circle, rgb(8 7 7) 0 21%, ${fill} 25%, ${fill} 56%, rgb(16 13 10) 70%)`
                    : fill,
            }}
          >
            {selected ? ring : null}
            {edge}
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

/** Wrapping pills for choices with longer or many labels; the pick is filled with ink. */
export function ChipRadio<T extends string>({
  label,
  value,
  options,
  onChange,
}: ChipRadioProps<T>) {
  const indicator = `chip-${useId()}`;
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
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
              'text-ui relative h-8 rounded-full px-3 transition-[color,box-shadow,scale] duration-200 active:scale-[0.97] active:duration-100 disabled:opacity-40',
              active
                ? 'text-paper'
                : 'text-ink-muted hover:text-ink shadow-[inset_0_0_0_1px_rgb(23_26_33/0.18)] hover:shadow-[inset_0_0_0_1px_rgb(23_26_33/0.45)]',
            )}
          >
            {active ? <SlidingIndicator layoutId={indicator} className={PILL_FILL} /> : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
