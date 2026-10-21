'use client';

import { CheckIcon, ProhibitIcon } from '@phosphor-icons/react';
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

import { SlidingIndicator } from './controls';

/** The layout id of this grid's selection ring, so it travels only within its own grid. */
const RingId = createContext<string | undefined>(undefined);

const RING = 'rounded-tile inset-0 shadow-[inset_0_0_0_2px_var(--color-marquee)]';

/**
 * Arrow keys move between the radios of a grid (visual order), Home/End jump
 * to the ends; Space/Enter select through the native button.
 */
export function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const radios = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
  );
  const index = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const top = radios[index].offsetTop;
  const columns = Math.max(1, radios.filter((radio) => radio.offsetTop === top).length);
  const step: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: columns,
    ArrowUp: -columns,
  };
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? radios.length - 1
        : Math.min(radios.length - 1, Math.max(0, index + step[event.key]));
  radios[next]?.focus();
}

interface OptionGridProps {
  label: string;
  children: ReactNode;
  className?: string;
  /** Tile columns; swatch grids pass their own. */
  columns?: string;
  /**
   * Long lists: when the grid opens with its pick below the fold, scroll the
   * panel (before paint, no animation) so the current choice is in view.
   */
  revealSelected?: boolean;
}

/**
 * A grid of picks. Tiles arrive in a short stagger (CSS, once per mount) and
 * the amber selection ring slides from the old pick to the new one.
 */
export function OptionGrid({
  label,
  children,
  className,
  columns,
  revealSelected = false,
}: OptionGridProps) {
  const ringId = `tile-ring-${useId()}`;
  const grid = useRef<HTMLDivElement>(null);

  // Once, on mount: later picks happen where the user already is.
  useLayoutEffect(() => {
    if (!revealSelected) return;
    const picked = grid.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    const scroller = picked?.closest<HTMLElement>('[role="tabpanel"]');
    if (!picked || !scroller) return;
    const view = scroller.getBoundingClientRect();
    const tile = picked.getBoundingClientRect();
    // Only a pick below the fold: one in the first row, or one that already
    // peeks in, stays put. On a short panel (phones) centring it would scroll
    // the controls above the grid (the outfit slots) out of view.
    const first = grid.current?.querySelector<HTMLElement>('[role="radio"]');
    const firstRow = !!first && Math.abs(first.getBoundingClientRect().top - tile.top) < 1;
    if (firstRow || tile.top <= view.bottom - 40) return;
    scroller.scrollTop += tile.top - view.top - (view.height - tile.height) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, by design
  }, []);

  return (
    <RingId value={ringId}>
      <div
        ref={grid}
        role="radiogroup"
        aria-label={label}
        onKeyDown={onGridKeyDown}
        className={cn('stagger-in grid gap-x-2.5 gap-y-4', columns ?? 'grid-cols-3', className)}
      >
        {children}
      </div>
    </RingId>
  );
}

interface OptionTileProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  /** Thumbnail URL; a lit monogram stands in when it is missing or fails. */
  image?: string;
  /** The "none" choice: an empty tile with a muted mark. */
  none?: boolean;
  /** Small colour dots under the label (tint presets). */
  swatches?: readonly string[];
  disabled?: boolean;
}

/**
 * A 3:4 option with its label always visible (scanable). The frame lifts on
 * hover and sinks on press; the selected one carries the amber ring and tick.
 */
export function OptionTile({
  label,
  selected,
  onSelect,
  image,
  none = false,
  swatches,
  disabled,
}: OptionTileProps) {
  const ringId = useContext(RingId);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImage = Boolean(image) && !broken && !none;
  // A single colourway is not a choice: dots only when there are several.
  const dots = swatches && swatches.length > 1 ? swatches.slice(0, 5) : undefined;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className="group/tile flex min-w-0 flex-col gap-2 text-left outline-none disabled:opacity-40"
    >
      {/* The frame moves (translate/scale only); the ring rides on it. */}
      <span className="ease-out-expo relative block transition-[translate,scale] duration-300 group-hover/tile:-translate-y-0.5 group-active/tile:translate-y-0 group-active/tile:scale-[0.98] group-active/tile:duration-100">
        <span
          className={cn(
            'rounded-tile bg-backstage-raised group-focus-visible/tile:outline-marquee relative block aspect-[3/4] w-full overflow-hidden transition-[box-shadow] duration-300 group-hover/tile:shadow-[0_10px_24px_rgb(5_5_4/0.45)] group-focus-visible/tile:outline-2 group-focus-visible/tile:outline-offset-2',
            selected ? 'ring-0' : 'ring-hairline group-hover/tile:ring-ink-faint ring-1',
            // Until the art arrives the tile carries the slow tungsten sweep, not a blank box.
            showImage &&
              !loaded &&
              'after:animate-skeleton-sweep after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent,rgb(255_226_176/0.06),transparent)]',
          )}
        >
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- local manifest art, no optimizer needed
            <img
              ref={(node) => {
                // Cached art can finish before React attaches onLoad.
                if (node?.complete && node.naturalWidth > 0) setLoaded(true);
              }}
              src={image}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
              className={cn(
                'ease-out-expo size-full object-cover transition-[opacity,scale] duration-500 group-hover/tile:scale-[1.03]',
                loaded ? 'opacity-100' : 'opacity-0',
              )}
            />
          ) : none ? (
            <span className="text-ink-faint flex size-full items-center justify-center">
              <ProhibitIcon className="size-7" weight="light" aria-hidden="true" />
            </span>
          ) : (
            <span className="flex size-full items-end bg-[radial-gradient(90%_70%_at_50%_20%,rgb(255_226_176/0.12),transparent_70%)] p-2.5">
              <span className="font-display text-subhead text-ink/25">{label.slice(0, 2)}</span>
            </span>
          )}
          {selected ? (
            <span className="bg-marquee text-backstage animate-mark-in absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full shadow-[0_2px_6px_rgb(5_5_4/0.5)]">
              <CheckIcon weight="bold" className="size-3" aria-hidden="true" />
            </span>
          ) : null}
        </span>
        {selected ? (
          ringId ? (
            <SlidingIndicator layoutId={ringId} className={RING} />
          ) : (
            <span aria-hidden="true" className={cn('pointer-events-none absolute', RING)} />
          )
        ) : null}
      </span>
      <span
        className={cn(
          'text-label line-clamp-2 leading-tight transition-colors duration-200',
          selected ? 'text-ink font-medium' : 'text-ink-muted group-hover/tile:text-ink',
        )}
      >
        {label}
      </span>
      {dots ? (
        <span className="-mt-0.5 flex gap-1" aria-hidden="true">
          {/* Colourways can repeat a colour: key by position. */}
          {dots.map((color, index) => (
            <span
              key={`${index}-${color}`}
              className="ring-hairline size-2 rounded-full ring-1"
              style={{ background: color }}
            />
          ))}
        </span>
      ) : null}
    </button>
  );
}
