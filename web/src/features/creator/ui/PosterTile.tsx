'use client';

import { useState } from 'react';

import { CheckIcon } from './icons';

interface PosterTileProps {
  label: string;
  /** Baked poster artwork; a lettered composition stands in until it exists. */
  image?: string;
  selected: boolean;
  onSelect: () => void;
  /** Optional dots previewing the colours this option comes in. */
  swatches?: readonly string[];
  /** Visual treatment for the "none" option. */
  variant?: 'art' | 'empty';
}

/**
 * A 3:4 poster in a catalog row. Focus (hover or keyboard) lifts it and
 * reveals its title; selection is a marquee inner border plus a check badge.
 */
export function PosterTile({
  label,
  image,
  selected,
  onSelect,
  swatches,
  variant = 'art',
}: PosterTileProps) {
  const [broken, setBroken] = useState(false);
  const showImage = image && !broken && variant === 'art';

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className="group/tile rounded-tile bg-backstage-raised ease-out-expo relative aspect-[3/4] w-[7.25rem] shrink-0 snap-start text-left transition-[translate,scale,box-shadow] duration-500 outline-none hover:z-10 hover:-translate-y-1 hover:scale-[1.06] hover:shadow-[0_18px_40px_rgba(0,0,0,0.55)] focus-visible:z-10 focus-visible:-translate-y-1 focus-visible:scale-[1.06] focus-visible:shadow-[0_18px_40px_rgba(0,0,0,0.55)] focus-visible:outline-none"
    >
      <span className="rounded-tile absolute inset-0 overflow-hidden">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- baked local art, no optimizer needed
          <img
            src={image}
            alt=""
            draggable={false}
            onError={() => setBroken(true)}
            className="ease-out-expo h-full w-full object-cover transition-transform duration-700 group-hover/tile:scale-[1.04]"
          />
        ) : variant === 'empty' ? (
          <span className="flex h-full w-full items-center justify-center bg-[repeating-linear-gradient(135deg,transparent_0_10px,rgba(255,255,255,0.035)_10px_11px)]">
            <span className="border-hairline h-10 w-10 rounded-full border" />
          </span>
        ) : (
          <span className="flex h-full w-full items-end bg-[radial-gradient(120%_80%_at_50%_0%,#2b2830_0%,#1b1a1d_70%)] p-3">
            <span className="font-display text-ink/10 text-[2.6rem] leading-[0.8]">
              {label.slice(0, 2)}
            </span>
          </span>
        )}
        {/* Title scrim: hidden at rest, revealed on focus like a catalog wall. */}
        <span className="ease-out-expo pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pt-8 pb-2.5 opacity-0 transition-[opacity,transform] duration-300 group-hover/tile:translate-y-0 group-hover/tile:opacity-100 group-focus-visible/tile:translate-y-0 group-focus-visible/tile:opacity-100">
          <span className="text-ink line-clamp-2 block text-[13px] leading-tight font-medium">
            {label}
          </span>
          {swatches && swatches.length > 0 && (
            <span className="mt-1.5 flex gap-1">
              {swatches.slice(0, 5).map((color) => (
                <span
                  key={color}
                  className="h-2 w-2 rounded-full ring-1 ring-white/20"
                  style={{ background: color }}
                />
              ))}
            </span>
          )}
        </span>
      </span>

      <span
        className={`rounded-tile pointer-events-none absolute inset-0 transition-[box-shadow] duration-300 ring-inset ${
          selected ? 'ring-marquee ring-2' : 'ring-1 ring-white/[0.06]'
        }`}
      />
      {selected && (
        <span className="bg-marquee text-backstage absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
          <CheckIcon width={12} height={12} />
        </span>
      )}
    </button>
  );
}
