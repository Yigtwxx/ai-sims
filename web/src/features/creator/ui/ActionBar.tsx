'use client';

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  ShuffleIcon,
  SpinnerGapIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ActionBarProps {
  labels: { undo: string; redo: string; randomize: string; done: string; saving: string };
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  disabled?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRandomize: () => void;
  onDone: () => void;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);

/** Shortcut text for tooltips; only rendered on the client, when a tooltip opens. */
function Shortcut({ keys }: { keys: 'undo' | 'redo' | 'random' }) {
  const mod = isMac() ? '⌘' : 'Ctrl';
  const text = keys === 'undo' ? `${mod}+Z` : keys === 'redo' ? `${mod}+⇧+Z` : 'R';
  return <kbd className="text-ink-faint ml-2 font-sans">{text}</kbd>;
}

function IconAction({
  label,
  shortcut,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  shortcut: 'undo' | 'redo' | 'random';
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          size="icon"
          aria-label={label}
          aria-keyshortcuts={
            shortcut === 'undo'
              ? 'Control+Z Meta+Z'
              : shortcut === 'redo'
                ? 'Control+Shift+Z Meta+Shift+Z'
                : 'R'
          }
          disabled={disabled}
          onClick={onClick}
          className={cn('size-11', className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <Shortcut keys={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Pinned to the bottom of the panel: history as one paired control, randomize,
 * and the amber "Bitti" that opens the premiere.
 */
export function ActionBar({
  labels,
  canUndo,
  canRedo,
  saving,
  disabled,
  onUndo,
  onRedo,
  onRandomize,
  onDone,
}: ActionBarProps) {
  return (
    <footer className="border-hairline bg-backstage flex items-center gap-2.5 border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pt-4 lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Undo and redo read as one control: a shared frame split by a hairline. */}
      <div className="rounded-control border-hairline bg-backstage-raised flex shrink-0 items-center border shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
        <IconAction
          label={labels.undo}
          shortcut="undo"
          disabled={!canUndo || disabled}
          onClick={onUndo}
          className="hover:bg-backstage-lift rounded-r-none border-0 bg-transparent shadow-none"
        >
          <ArrowCounterClockwiseIcon className="size-5" aria-hidden="true" />
        </IconAction>
        <span aria-hidden="true" className="bg-hairline h-5 w-px" />
        <IconAction
          label={labels.redo}
          shortcut="redo"
          disabled={!canRedo || disabled}
          onClick={onRedo}
          className="hover:bg-backstage-lift rounded-l-none border-0 bg-transparent shadow-none"
        >
          <ArrowClockwiseIcon className="size-5" aria-hidden="true" />
        </IconAction>
      </div>
      <IconAction
        label={labels.randomize}
        shortcut="random"
        disabled={disabled}
        onClick={onRandomize}
      >
        <ShuffleIcon className="size-5" aria-hidden="true" />
      </IconAction>
      <Button
        type="button"
        variant="primary"
        size="lg"
        onClick={onDone}
        disabled={saving || disabled}
        aria-busy={saving || undefined}
        className="group/done font-display ml-1.5 h-12 min-w-0 flex-1 text-[1.375rem] lg:h-13"
      >
        {saving ? (
          <>
            <SpinnerGapIcon className="size-5 animate-spin" aria-hidden="true" />
            <span className="text-ui font-sans">{labels.saving}</span>
          </>
        ) : (
          <>
            {labels.done}
            <ArrowRightIcon
              weight="bold"
              aria-hidden="true"
              className="ease-out-expo size-5 transition-transform duration-300 group-hover/done:translate-x-1"
            />
          </>
        )}
      </Button>
    </footer>
  );
}
