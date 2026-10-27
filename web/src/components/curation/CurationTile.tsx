'use client';

import {
  ApproximateEqualsIcon,
  ArrowsOutSimpleIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  PersonSimpleWalkIcon,
  ScissorsIcon,
  SmileyIcon,
  TShirtIcon,
  UserIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useId, type MouseEvent } from 'react';

import { thumbnailSrc } from '@/features/creator/useMhManifest';
import { cn } from '@/lib/utils';

import type { CurationItem, ItemGlyph } from './items';

const GLYPHS: Record<ItemGlyph, Icon> = {
  face: UserIcon,
  groom: ScissorsIcon,
  outfit: TShirtIcon,
  bodyMotion: PersonSimpleWalkIcon,
  faceMotion: SmileyIcon,
};

/** Pre-translated facts under the label, shared by the tile and the preview. */
export function useMetaText() {
  const t = useTranslations('Curate.meta');
  return (item: CurationItem): string => {
    const parts = item.meta.map((token) =>
      token === 'female' ||
      token === 'male' ||
      token === 'unisex' ||
      token === 'body' ||
      token === 'face'
        ? t(token)
        : token,
    );
    if (item.tone !== undefined) parts.push(t('tone', { value: item.tone }));
    if (item.tints) parts.push(t('tints', { count: item.tints }));
    return parts.join(' · ');
  };
}

/** The item's picture: thumbnail, skin swatch, or a glyph for animations. */
export function ItemPicture({
  item,
  muted = false,
  className,
}: {
  item: CurationItem;
  muted?: boolean;
  className?: string;
}) {
  const src = thumbnailSrc(item.thumbnail);
  const dim = muted && 'opacity-35 grayscale';
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- manifest thumbnails are local, pre-sized WebP
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn('size-full object-cover transition duration-300', dim, className)}
      />
    );
  }
  if (item.swatch) {
    return (
      <span
        aria-hidden="true"
        className={cn('block size-full transition duration-300', dim, className)}
        style={{
          background: `radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.18), transparent 55%), ${item.swatch}`,
        }}
      />
    );
  }
  const Glyph = GLYPHS[item.glyph];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'text-ink-faint flex size-full items-center justify-center transition duration-300',
        dim,
        className,
      )}
    >
      <Glyph className="size-10" weight="thin" />
    </span>
  );
}

/** Why the similarity pre-pass picked an item, ready to print. */
export interface SimilarCaption {
  /** Label of the item kept in its place, in the active locale. */
  label: string;
  /** How far apart the two are, formatted with its unit. */
  distance: string;
}

interface CurationTileProps {
  item: CurationItem;
  meta: string;
  hidden: boolean;
  /** Set for a pick of the similarity pre-pass. */
  similar?: SimilarCaption;
  selected: boolean;
  onSelect: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  onToggle: (id: string) => void;
  onPreview: (id: string) => void;
}

export function CurationTile({
  item,
  meta,
  hidden,
  similar,
  selected,
  onSelect,
  onToggle,
  onPreview,
}: CurationTileProps) {
  const t = useTranslations('Curate.item');
  const captionId = useId();
  const caption = similar ? t('similarTo', { label: similar.label }) : null;
  return (
    <li className="relative">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('select', { name: item.label })}
        aria-describedby={caption ? captionId : undefined}
        onClick={(event) => onSelect(item.id, event)}
        className={cn(
          'rounded-tile bg-paper-raised relative block w-full overflow-hidden border text-left transition-[border-color,box-shadow] duration-200',
          selected
            ? 'border-cobalt shadow-[0_0_0_1px_var(--color-cobalt)]'
            : 'border-hairline hover:border-ink-faint',
        )}
      >
        <span className="bg-paper-deep block aspect-[3/4] overflow-hidden">
          <ItemPicture item={item} muted={hidden} />
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-2 left-2 flex size-5 items-center justify-center rounded-[5px] border transition-colors duration-150',
            selected ? 'border-cobalt bg-cobalt text-paper' : 'bg-paper/70 border-white/25',
          )}
        >
          {selected ? <CheckIcon className="size-3.5" weight="bold" /> : null}
        </span>
        {hidden ? (
          <span className="bg-paper/85 text-label text-ink-muted absolute top-2 right-2 inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5">
            <EyeSlashIcon className="size-3.5" aria-hidden="true" />
            {t('hidden')}
          </span>
        ) : null}
        <span className="block px-2.5 pt-2 pb-10">
          <span className={cn('text-ui block truncate', hidden ? 'text-ink-muted' : 'text-ink')}>
            {item.label}
          </span>
          {meta ? <span className="text-label text-ink-faint block truncate">{meta}</span> : null}
          {similar && caption ? (
            <span
              id={captionId}
              title={`${caption} · ${similar.distance}`}
              className="text-label text-ink-muted mt-1.5 flex items-start gap-1"
            >
              <ApproximateEqualsIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span className="line-clamp-3">{caption}</span>
            </span>
          ) : null}
        </span>
      </button>
      <span className="absolute right-1.5 bottom-1.5 flex gap-1">
        <IconAction label={t('preview', { name: item.label })} onClick={() => onPreview(item.id)}>
          <ArrowsOutSimpleIcon className="size-4" aria-hidden="true" />
        </IconAction>
        <IconAction
          label={t(hidden ? 'show' : 'hide', { name: item.label })}
          onClick={() => onToggle(item.id)}
          active={hidden}
        >
          {hidden ? (
            <EyeSlashIcon className="size-4" aria-hidden="true" />
          ) : (
            <EyeIcon className="size-4" aria-hidden="true" />
          )}
        </IconAction>
      </span>
    </li>
  );
}

function IconAction({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'rounded-tile inline-flex size-8 items-center justify-center transition-colors duration-150',
        active
          ? 'bg-paper-lift text-cobalt hover:text-ink'
          : 'text-ink-faint hover:bg-paper-lift hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
