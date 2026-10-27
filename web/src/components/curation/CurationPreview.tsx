'use client';

import { CaretLeftIcon, CaretRightIcon, EyeIcon, EyeSlashIcon } from '@phosphor-icons/react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useMemo, type KeyboardEvent } from 'react';

import { StageBoundary } from '@/components/stage/StageBoundary';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { CameraFocus } from '@/features/avatar/cameraFocus';
import type { MhManifest } from '@/lib/assets/manifest';

import { ItemPicture, useMetaText } from './CurationTile';
import { previewConfig, type CurationItem, type CurationTab } from './items';

// three.js only loads once someone opens a preview; the grid stays light.
const MhStage = dynamic(() => import('@/features/avatar/mh/MhStage').then((mod) => mod.MhStage), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

const OUTFIT_FOCUS: Record<string, CameraFocus> = {
  top: 'torso',
  bottom: 'legs',
  shoes: 'feet',
  full: 'body',
};

function focusFor(tab: CurationTab, item: CurationItem): CameraFocus {
  if (tab === 'outfits') return OUTFIT_FOCUS[item.category ?? 'full'] ?? 'body';
  return 'face';
}

interface CurationPreviewProps {
  manifest: MhManifest;
  fixture: boolean;
  tab: CurationTab;
  /** The items in on-screen order, for previous and next. */
  items: readonly CurationItem[];
  id: string | null;
  isHidden: (id: string) => boolean;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
  onClose: () => void;
}

export function CurationPreview({
  manifest,
  fixture,
  tab,
  items,
  id,
  isHidden,
  onToggle,
  onNavigate,
  onClose,
}: CurationPreviewProps) {
  const t = useTranslations('Curate.preview');
  const tItem = useTranslations('Curate.item');
  const tSelection = useTranslations('Curate.selection');
  const metaText = useMetaText();
  const index = id ? items.findIndex((entry) => entry.id === id) : -1;
  const item = index >= 0 ? items[index] : null;
  const config = useMemo(
    () => (item ? previewConfig(manifest, tab, item.id) : null),
    [manifest, tab, item],
  );

  const step = (delta: number) => {
    if (index < 0 || items.length === 0) return;
    onNavigate(items[(index + delta + items.length) % items.length].id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!item || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'h' || event.key === 'H') {
      if (!isHidden(item.id)) onToggle(item.id);
    } else if (event.key === 'k' || event.key === 'K') {
      if (isHidden(item.id)) onToggle(item.id);
    } else return;
    event.preventDefault();
  };

  const hidden = item ? isHidden(item.id) : false;
  const still = (
    <div className="relative size-full">
      {item ? <ItemPicture item={item} className="object-contain" /> : null}
    </div>
  );

  return (
    <Dialog open={item !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('close')} onKeyDown={onKeyDown} className="md:p-6">
        {item ? (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="rounded-tile bg-paper-deep relative h-[min(68vh,600px)] overflow-hidden">
              {config && !fixture ? (
                <StageBoundary
                  key={item.id}
                  fallback={() => (
                    <div className="relative size-full">
                      {still}
                      <p className="text-label text-ink-muted bg-paper/85 absolute inset-x-3 bottom-3 rounded-[5px] px-3 py-2">
                        {t('failed')}
                      </p>
                    </div>
                  )}
                >
                  <MhStage
                    config={config}
                    manifest={manifest}
                    mode="thumbnail"
                    focus={focusFor(tab, item)}
                    className="size-full"
                  />
                </StageBoundary>
              ) : (
                <div className="relative size-full">
                  {still}
                  <p className="text-label text-ink-muted bg-paper/85 absolute inset-x-3 bottom-3 rounded-[5px] px-3 py-2">
                    {config ? t('fixture') : t('unavailable')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-4 pt-1 md:pr-8">
              <div>
                {hidden ? (
                  <p className="text-label text-ink-muted mb-2 inline-flex items-center gap-1.5">
                    <EyeSlashIcon className="size-4" aria-hidden="true" />
                    {tItem('hidden')}
                  </p>
                ) : null}
                <DialogTitle className="text-title">{item.label}</DialogTitle>
                <DialogDescription className="mt-1 font-mono break-all">
                  {item.id}
                </DialogDescription>
              </div>
              {metaText(item) ? (
                <p className="text-body-sm text-ink-muted">{metaText(item)}</p>
              ) : null}
              <Button
                type="button"
                variant={hidden ? 'primary' : 'quiet'}
                aria-label={tItem(hidden ? 'show' : 'hide', { name: item.label })}
                onClick={() => onToggle(item.id)}
                className="self-start"
              >
                {hidden ? <EyeIcon aria-hidden="true" /> : <EyeSlashIcon aria-hidden="true" />}
                {tSelection(hidden ? 'show' : 'hide')}
              </Button>
              <div className="mt-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('previous')}
                  onClick={() => step(-1)}
                >
                  <CaretLeftIcon className="size-5" aria-hidden="true" />
                </Button>
                <p className="text-label text-ink-muted tabular-nums">
                  {t('position', { index: index + 1, total: items.length })}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('next')}
                  onClick={() => step(1)}
                >
                  <CaretRightIcon className="size-5" aria-hidden="true" />
                </Button>
              </div>
              <p className="text-label text-ink-faint">{t('keyboard')}</p>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
