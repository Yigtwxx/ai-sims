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
  HandGrabbingIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PencilSimpleIcon,
} from '@phosphor-icons/react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StageLoading } from '@/components/shell/StageLoading';
import { StageBoundary, StageFailed } from '@/components/stage/StageBoundary';
import { StagePoster } from '@/components/stage/StagePoster';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MhStage } from '@/features/avatar/mh/MhStage';
import { useMhManifest } from '@/features/creator/useMhManifest';
import { reconcileConfig } from '@/features/creator/reconcile';
import { Link } from '@/i18n/navigation';
import type { CharacterConfig } from '@/lib/character/schema';
import { cn } from '@/lib/utils';

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
  // Something is on the stage: the character, dressed and drawn, or the failure note.
  // Stable callback: the memoised stage must not re-render as replies stream in.
  const [stageShown, setStageShown] = useState(false);
  const markStageShown = useCallback(() => setStageShown(true), []);
  // A retry mounts the stage afresh: the loading caption returns until it settles.
  const retryStage = (retry: () => void) => {
    setStageShown(false);
    retry();
  };

  // Next keeps visited pages alive (Activity). A new visit to a kept talk page
  // (a push; back and forward keep bfcacheId) gets a fresh stage: the kept one
  // would hold the character it showed last time on screen until the edited
  // one had assembled behind it, so the old look would show first.
  const { bfcacheId } = useRouter();
  const [stageVisit, setStageVisit] = useState(bfcacheId);
  if (stageVisit !== bfcacheId) {
    setStageVisit(bfcacheId);
    setStageShown(false);
  }

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
    <main className="bg-paper relative flex h-dvh w-full flex-col overflow-hidden lg:block">
      <section
        aria-label={t('stageLabel', { name: character.name })}
        className="relative h-[46dvh] shrink-0 lg:absolute lg:inset-0 lg:h-auto"
      >
        {manifest ? (
          <StageBoundary
            key={bfcacheId}
            fallback={(retry) => (
              <>
                <StageFailed retry={() => retryStage(retry)} insetRight={panelWidth} />
                <OnMount run={markStageShown} />
              </>
            )}
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
              onSettled={markStageShown}
              className="size-full"
            />
          </StageBoundary>
        ) : (
          <div
            className="absolute inset-0 [--stage-floor:84%] [--stage-x:calc(50%-var(--panel,0px)/2)] lg:[--panel:clamp(360px,30vw,480px)]"
            style={panelWidth ? { ['--panel' as string]: `${panelWidth}px` } : undefined}
          >
            <StagePoster />
          </div>
        )}
      </section>

      {/* Over the stage, left of the chat: name, navigation, zoom and subtitles. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[46dvh] lg:inset-y-0 lg:h-auto',
          // Until the chat column is measured, assume its CSS width so nothing jumps.
          !panelWidth && 'lg:right-[clamp(360px,30vw,480px)]',
        )}
        style={panelWidth ? { right: panelWidth } : undefined}
      >
        {/* Lower left of the stage, as on the creator: clear of the character and the zoom. */}
        <StageLoading
          show={
            !stageShown && manifestState.status !== 'missing' && manifestState.status !== 'error'
          }
          label={t('loadingCharacter')}
          className="absolute bottom-4 left-4 max-w-[calc(100%-6rem)] md:bottom-10 md:left-8"
        />

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
          ) : talk.messages.length === 0 && zoom === 0 && stageShown ? (
            <p className="border-hairline bg-paper/70 text-label text-ink-muted hidden items-center gap-2 rounded-full border px-4 py-1.5 lg:inline-flex">
              <HandGrabbingIcon className="size-3.5" aria-hidden="true" />
              {t('dragHint')}
            </p>
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
        className="border-hairline bg-paper relative z-10 flex min-h-0 flex-1 flex-col border-t lg:absolute lg:inset-y-0 lg:right-0 lg:w-[clamp(360px,30vw,480px)] lg:border-t-0 lg:border-l lg:shadow-[-24px_0_60px_rgb(23_26_33/0.1)]"
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
          onDismissNotice={talk.dismissNotice}
        />
      </aside>
    </main>
  );
}

/** Runs `run` once when mounted (a render-function fallback cannot set state itself). */
function OnMount({ run }: { run: () => void }) {
  useEffect(() => run(), [run]);
  return null;
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
          className="bg-paper/80"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
