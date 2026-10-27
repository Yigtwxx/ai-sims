'use client';

import { ChatCircleDotsIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { DotPoster } from '@/components/stage/DotPoster';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, useRouter } from '@/i18n/navigation';
import { deleteCharacterAction } from '@/lib/characters/actions';

export interface CharacterCardData {
  id: string;
  name: string;
  status: 'draft' | 'finalized';
  hasThumbnail: boolean;
  /** Already formatted on the server ("3 dakika önce"). */
  updated: string;
}

/**
 * A saved character: its portrait, name, state and the three things you can do
 * with it. "Konuş" is quiet until the card is pointed at or focused, then it
 * fills with ink: one inked card at a time, never a wall of dark buttons.
 */
export function CharacterCard({ character }: { character: CharacterCardData }) {
  const t = useTranslations('Characters');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const name = character.name || t('untitled');

  const remove = () =>
    startTransition(async () => {
      // A network failure rejects the action; keep it a toast, not the error page.
      const result = await deleteCharacterAction(character.id).catch(
        () => ({ ok: false }) as const,
      );
      if (!result.ok) {
        toast.error(t('deleteFailed'));
        return;
      }
      setOpen(false);
      setRemoved(true);
      toast.success(t('deleted', { name }));
      router.refresh();
    });

  if (removed) return null;

  return (
    <li className="group relative flex flex-col">
      <Link
        href={`/characters/${character.id}/talk`}
        aria-label={`${name}, ${t('actions.talk')}`}
        className="rounded-tile bg-paper-raised ring-hairline group-hover:ring-ink-faint relative block aspect-[3/4] overflow-hidden ring-1 transition-[box-shadow] duration-300"
      >
        {character.hasThumbnail && !broken ? (
          <>
            {loaded ? null : (
              // Behind the image while it streams in: the slow light sweep, not a blank box.
              <span
                aria-hidden="true"
                className="after:animate-skeleton-sweep absolute inset-0 after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.45),transparent)]"
              />
            )}
            {/* Private, session-gated image: next/image optimization does not apply. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={(node) => {
                // Server-rendered: the image may finish (or fail) before hydration attaches
                // onLoad and onError; a failed one is complete with no pixels.
                if (!node?.complete) return;
                if (node.naturalWidth > 0) setLoaded(true);
                else setBroken(true);
              }}
              src={`/api/characters/${character.id}/thumbnail`}
              alt=""
              width={480}
              height={640}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
              className="ease-out-expo relative size-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            />
          </>
        ) : (
          // No portrait yet: the paper studio with the dot silhouette, as on the stage.
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--color-paper-raised),var(--color-paper-lift)_88%,var(--color-paper-deep))] [--stage-floor:90%] [--stage-x:50%]"
          >
            <DotPoster />
          </span>
        )}
        {/* Finished is the normal state; only an unfinished draft needs a label. */}
        {character.status === 'draft' ? (
          <span className="text-label border-hairline bg-paper/85 text-ink-muted absolute top-3 left-3 rounded-full border px-2.5 py-1">
            {t('status.draft')}
          </span>
        ) : null}
      </Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-title text-ink truncate">{name}</p>
          <p className="text-label text-ink-faint mt-0.5">
            {t('updated', { time: character.updated })}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <Button
          asChild
          variant="quiet"
          size="sm"
          className="group-focus-within:border-ink group-focus-within:bg-ink group-focus-within:text-paper group-hover:border-ink group-hover:bg-ink group-hover:text-paper hover:bg-ink/85 min-w-0 flex-1"
        >
          <Link href={`/characters/${character.id}/talk`}>
            <ChatCircleDotsIcon
              weight="fill"
              aria-hidden="true"
              className="text-cobalt group-focus-within:text-paper group-hover:text-paper hidden transition-colors duration-200 min-[480px]:block"
            />
            {t('actions.talk')}
          </Link>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon" className="size-9">
              <Link
                href={`/characters/${character.id}/edit`}
                aria-label={`${t('actions.edit')}: ${name}`}
              >
                <PencilSimpleIcon aria-hidden="true" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('actions.edit')}</TooltipContent>
        </Tooltip>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hover:text-alert size-9"
                  aria-label={`${t('actions.delete')}: ${name}`}
                >
                  <TrashIcon aria-hidden="true" />
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('actions.delete')}</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('deleteDialog.title', { name })}</AlertDialogTitle>
              <AlertDialogDescription>{t('deleteDialog.body')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{t('deleteDialog.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  // Keep the dialog open until the server confirms.
                  event.preventDefault();
                  remove();
                }}
              >
                {pending ? t('deleteDialog.deleting') : t('deleteDialog.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}
