/*
 * THESIS: Talking is a two-shot: the character stands full height in the
 * light on the left, the conversation is a quiet column on the right. No
 * picture-in-picture; the subtitles under the character carry the voice.
 * STORY: Ask, watch it think, hear it answer with its lips on the words;
 * zoom in to look closer, turn it by dragging.
 */
'use client';

import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PencilSimpleIcon,
} from '@phosphor-icons/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { StageBoundary, StageFailed } from '@/components/stage/StageBoundary';
import { StagePoster } from '@/components/stage/StagePoster';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MhStage } from '@/features/avatar/mh/MhStage';
import { useMhManifest } from '@/features/creator/useMhManifest';
import { reconcileConfig } from '@/features/creator/reconcile';
import { Link } from '@/i18n/navigation';
import type { CharacterConfig } from '@/lib/character/schema';

import { Subtitles } from './Subtitles';
import { TalkChat } from './TalkChat';
import { useTalk } from './useTalk';

const ZOOM_STEP = 0.2;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface TalkCharacter {
  id: string;
  name: string;
  config: CharacterConfig;
}

export function TalkScreen({ character }: { character: TalkCharacter }) {
  const t = useTranslations('Talk');
  const locale = useLocale() === 'en' ? 'en' : 'tr';
  const manifestState = useMhManifest();
  const manifest = manifestState.status === 'ready' ? manifestState.manifest : undefined;
  const [zoom, setZoom] = useState(0);
  const [panelWidth, setPanelWidth] = useState(0);
  const panel = useRef<HTMLElement>(null);

  const talk = useTalk({
    characterId: character.id,
    locale,
    voice: character.config.voice.gender,
  });

  useEffect(() => {
    const el = panel.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const wide = window.matchMedia('(min-width: 1024px)').matches;
      setPanelWidth(wide ? Math.round(entry.contentRect.width) : 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Stable identity: the stage re-resolves the character only when the inputs change.
  const config = useMemo(
    () => (manifest ? reconcileConfig(character.config, manifest) : character.config),
    [manifest, character.config],
  );
  const thinking = talk.phase === 'connecting' || talk.phase === 'thinking';

  return (
    <main className="bg-backstage relative flex h-dvh w-full flex-col overflow-hidden lg:block">
      <section
        aria-label={t('stageLabel', { name: character.name })}
        className="relative h-[46dvh] shrink-0 lg:absolute lg:inset-0 lg:h-auto"
      >
        {manifest ? (
          <StageBoundary
            fallback={(retry) => <StageFailed retry={retry} insetRight={panelWidth} />}
          >
            <MhStage
              config={config}
              manifest={manifest}
              mode="talk"
              zoom={zoom}
              onZoomChange={setZoom}
              speech={talk.player}
              thinking={thinking}
              insetRight={panelWidth}
              className="size-full"
            />
          </StageBoundary>
        ) : (
          <div
            className="absolute inset-0 [--stage-floor:84%] [--stage-x:calc(50%-var(--panel,0px)/2)]"
            style={{ ['--panel' as string]: `${panelWidth}px` }}
          >
            <StagePoster />
          </div>
        )}
      </section>

      {/* Over the stage, left of the chat: name, navigation, zoom and subtitles. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[46dvh] lg:inset-y-0 lg:h-auto"
        style={{ right: panelWidth }}
      >
        <div className="pointer-events-auto flex items-start justify-between gap-4 px-5 pt-5 md:px-8">
          <div>
            <Link
              href="/characters"
              className="rounded-tile text-label text-ink-muted hover:text-ink -ml-1 inline-flex items-center gap-1.5 px-1 transition-colors"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              {t('back')}
            </Link>
            <h1 className="font-display text-headline text-ink mt-2">{character.name}</h1>
          </div>
          <Button asChild variant="quiet" size="sm">
            <Link href={`/characters/${character.id}/edit`}>
              <PencilSimpleIcon aria-hidden="true" />
              {t('edit')}
            </Link>
          </Button>
        </div>

        <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-4 px-6 md:bottom-10">
          <Subtitles line={talk.line} lang={locale} />
          {manifestState.status === 'missing' || manifestState.status === 'error' ? (
            <div
              role="status"
              className="pointer-events-auto flex flex-wrap items-center justify-center gap-3"
            >
              <p className="text-label text-ink-muted">
                {t(manifestState.status === 'missing' ? 'manifestMissing' : 'manifestError')}
              </p>
              <Button type="button" variant="quiet" size="sm" onClick={manifestState.retry}>
                <ArrowClockwiseIcon aria-hidden="true" />
                {t('retry')}
              </Button>
            </div>
          ) : talk.messages.length === 0 && zoom === 0 ? (
            <p className="text-label text-ink-faint hidden lg:block">{t('dragHint')}</p>
          ) : null}
        </div>

        <div
          role="group"
          aria-label={t('zoom.label')}
          className="pointer-events-auto absolute right-5 bottom-6 flex flex-col items-end gap-2 md:right-8 md:bottom-10"
        >
          <ZoomButton
            label={t('zoom.in')}
            disabled={zoom >= 1}
            onClick={() => setZoom(clamp01(zoom + ZOOM_STEP))}
          >
            <MagnifyingGlassPlusIcon className="size-5" aria-hidden="true" />
          </ZoomButton>
          <ZoomButton
            label={t('zoom.out')}
            disabled={zoom <= 0}
            onClick={() => setZoom(clamp01(zoom - ZOOM_STEP))}
          >
            <MagnifyingGlassMinusIcon className="size-5" aria-hidden="true" />
          </ZoomButton>
          {zoom > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setZoom(0)}
              className="text-label h-8 px-2"
            >
              {t('zoom.reset')}
            </Button>
          ) : null}
        </div>
      </div>

      <aside
        ref={panel}
        className="border-hairline bg-backstage relative z-10 flex min-h-0 flex-1 flex-col border-t lg:absolute lg:inset-y-0 lg:right-0 lg:w-[clamp(360px,30vw,480px)] lg:border-t-0 lg:border-l lg:shadow-[-24px_0_60px_rgb(5_5_4/0.35)]"
      >
        <TalkChat
          name={character.name}
          messages={talk.messages}
          phase={talk.phase}
          speaking={talk.speaking}
          voiceOn={talk.voiceOn}
          notice={talk.notice}
          onSend={talk.send}
          onStop={talk.stop}
          onRetry={talk.retry}
          onToggleVoice={talk.toggleVoice}
        />
      </aside>
    </main>
  );
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="bg-backstage/80"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
