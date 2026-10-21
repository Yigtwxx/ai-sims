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
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { deleteCharacterAction } from '@/lib/characters/actions';
import { cn } from '@/lib/utils';

export interface CharacterCardData {
  id: string;
  name: string;
  status: 'draft' | 'finalized';
  hasThumbnail: boolean;
  /** Already formatted on the server ("3 dakika önce"). */
  updated: string;
}

/** A saved character: its portrait, name, state and the three things you can do with it. */
export function CharacterCard({ character }: { character: CharacterCardData }) {
  const t = useTranslations('Characters');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [broken, setBroken] = useState(false);
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
        className="rounded-tile bg-backstage-raised ring-hairline hover:ring-ink-faint relative block aspect-[3/4] overflow-hidden ring-1 transition-[box-shadow] duration-300"
      >
        {character.hasThumbnail && !broken ? (
          // Private, session-gated image: next/image optimization does not apply.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/characters/${character.id}/thumbnail`}
            alt=""
            width={480}
            height={640}
            loading="lazy"
            onError={() => setBroken(true)}
            className="ease-out-expo size-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : (
          <span aria-hidden="true" className="absolute inset-0">
            <span className="absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_30%,rgb(255_226_176/0.14),transparent_72%)]" />
            <span className="absolute bottom-[18%] left-1/2 h-10 w-2/3 -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(255_226_176/0.16),transparent)]" />
            <span className="font-display text-ink/15 absolute inset-x-0 top-[34%] text-center text-[clamp(3rem,6vw,4.5rem)]">
              {name.slice(0, 1).toLocaleUpperCase()}
            </span>
          </span>
        )}
        <span
          className={cn(
            'text-label absolute top-3 left-3 rounded-full px-2.5 py-1',
            character.status === 'finalized'
              ? 'bg-backstage/80 text-ink'
              : 'border-hairline bg-backstage/80 text-ink-muted border',
          )}
        >
          {t(`status.${character.status}`)}
        </span>
      </Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-title text-ink truncate">{name}</p>
          <p className="text-label text-ink-faint mt-0.5">
            {t('updated', { time: character.updated })}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button asChild variant="primary" size="sm" className="flex-1">
          <Link href={`/characters/${character.id}/talk`}>
            <ChatCircleDotsIcon weight="fill" aria-hidden="true" />
            {t('actions.talk')}
          </Link>
        </Button>
        <Button asChild variant="quiet" size="sm" className="flex-1">
          <Link href={`/characters/${character.id}/edit`}>
            <PencilSimpleIcon aria-hidden="true" />
            {t('actions.edit')}
          </Link>
        </Button>
        <AlertDialog open={open} onOpenChange={setOpen}>
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
