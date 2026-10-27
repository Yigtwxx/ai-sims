'use client';

import { CheckIcon, ProhibitIcon } from '@phosphor-icons/react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

import { useRevealSelected } from './OptionGrid';

export interface OptionListItem {
  /** What is picked and reported; null is the "none" row. */
  value: string | null;
  label: string;
  /** Small mono line under the name (a length, a colourway count). */
  meta?: string;
  /** Thumbnail URL; a monogram stands in when it is missing or fails. */
  image?: string;
  /** Colourway dots after the meta line. */
  swatches?: readonly string[];
}

interface OptionListProps {
  label: string;
  items: readonly OptionListItem[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Long lists: open scrolled to the pick (see useRevealSelected). */
  revealSelected?: boolean;
}

/**
 * A list of picks for things with many named variants (grooms, garments):
 * a small thumbnail, the name, a mono meta line and a cobalt tick, rows split
 * by hairlines. Arrow keys, Home and End move between rows (one tab stop, on
 * the pick); Space or Enter picks.
 *
 * Each row is named by its label alone and the meta is drawn from an attribute
 * (CSS content): the row reads, and is matched by tests, exactly as the name.
 */
export function OptionList({
  label,
  items,
  value,
  onChange,
  revealSelected = false,
}: OptionListProps) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  useRevealSelected(list, revealSelected);
  // The tab stop sits on the pick; with the pick filtered out, on the first row.
  const stop = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
    rows[next]?.focus();
  };

  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="stagger-in border-hairline flex flex-col border-t"
    >
      {items.map((item, index) => (
        <OptionRow
          key={item.value ?? '∅'}
          id={`${id}-${index}`}
          item={item}
          selected={item.value === value}
          tabbable={index === stop}
          onSelect={() => onChange(item.value)}
        />
      ))}
    </div>
  );
}

function OptionRow({
  id,
  item,
  selected,
  tabbable,
  onSelect,
}: {
  id: string;
  item: OptionListItem;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const none = item.value === null;
  const showImage = Boolean(item.image) && !broken && !none;
  const dots = item.swatches && item.swatches.length > 1 ? item.swatches.slice(0, 6) : undefined;
  const nameId = `${id}-name`;
  const metaId = `${id}-meta`;

  return (
    <>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-labelledby={nameId}
        aria-describedby={item.meta ? metaId : undefined}
        tabIndex={tabbable ? 0 : -1}
        onClick={onSelect}
        className={cn(
          'group/row border-hairline relative flex min-h-17 w-full items-center gap-3 border-b py-1.5 pr-3 pl-1.5 text-left transition-colors duration-150 focus-visible:z-10 focus-visible:-outline-offset-2',
          selected ? 'bg-paper-lift' : 'hover:bg-paper-lift/70',
        )}
      >
        <span
          aria-hidden="true"
          data-monogram={showImage || none ? undefined : item.label.slice(0, 2)}
          className={cn(
            'bg-paper-deep relative flex h-14 w-11 shrink-0 items-end overflow-hidden rounded-sm p-1 shadow-[inset_0_0_0_1px_rgb(23_26_33/0.08)]',
            'font-display text-ink/30 text-[15px] before:content-[attr(data-monogram)]',
            none && 'text-ink-faint items-center justify-center p-0',
            showImage &&
              !loaded &&
              'after:animate-skeleton-sweep after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.45),transparent)]',
          )}
        >
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- local manifest art, no optimizer needed
            <img
              ref={(node) => {
                // Cached art can finish before React attaches onLoad.
                if (node?.complete && node.naturalWidth > 0) setLoaded(true);
              }}
              src={item.image}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
              className={cn(
                'ease-out-expo absolute inset-0 size-full object-cover transition-[opacity,scale] duration-500 group-hover/row:scale-[1.04]',
                loaded ? 'opacity-100' : 'opacity-0',
              )}
            />
          ) : none ? (
            <ProhibitIcon className="size-5" weight="light" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            id={nameId}
            className={cn(
              'text-ui leading-snug transition-colors duration-150',
              selected ? 'text-ink font-semibold' : 'text-ink-muted group-hover/row:text-ink',
            )}
          >
            {item.label}
          </span>
          {item.meta || dots ? (
            <span aria-hidden="true" className="flex items-center gap-2">
              {item.meta ? (
                <span
                  data-meta={item.meta}
                  className="text-ink-faint font-mono text-[11px] tracking-[0.08em] uppercase after:content-[attr(data-meta)]"
                />
              ) : null}
              {dots ? (
                <span className="flex gap-1">
                  {/* Colourways can repeat a colour: key by position. */}
                  {dots.map((color, index) => (
                    <span
                      key={`${index}-${color}`}
                      className="size-2 rounded-full shadow-[inset_0_0_0_1px_rgb(23_26_33/0.15)]"
                      style={{ background: color }}
                    />
                  ))}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        {selected ? (
          <CheckIcon
            weight="bold"
            aria-hidden="true"
            className="text-cobalt animate-mark-in size-4 shrink-0"
          />
        ) : null}
      </button>
      {/* The meta as text for assistive tech, outside the row so the row's text stays its name. */}
      {item.meta ? (
        <span id={metaId} hidden>
          {item.meta}
        </span>
      ) : null}
    </>
  );
}
