'use client';

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ShuffleIcon,
  SpinnerGapIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
  children,
}: {
  label: string;
  shortcut: 'undo' | 'redo' | 'random';
  disabled?: boolean;
  onClick: () => void;
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
          className="size-11"
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

/** Pinned to the bottom of the panel: history, randomize and the amber "Bitti". */
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
    <footer className="border-hairline bg-backstage flex items-center gap-2 border-t px-5 py-4">
      <IconAction
        label={labels.undo}
        shortcut="undo"
        disabled={!canUndo || disabled}
        onClick={onUndo}
      >
        <ArrowCounterClockwiseIcon className="size-5" aria-hidden="true" />
      </IconAction>
      <IconAction
        label={labels.redo}
        shortcut="redo"
        disabled={!canRedo || disabled}
        onClick={onRedo}
      >
        <ArrowClockwiseIcon className="size-5" aria-hidden="true" />
      </IconAction>
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
        className="font-display text-subhead ml-2 h-13 flex-1"
      >
        {saving ? (
          <>
            <SpinnerGapIcon className="size-5 animate-spin" aria-hidden="true" />
            <span className="text-ui font-sans">{labels.saving}</span>
          </>
        ) : (
          labels.done
        )}
      </Button>
    </footer>
  );
}
