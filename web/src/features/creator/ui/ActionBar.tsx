'use client';

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  ShuffleIcon,
  SpinnerGapIcon,
} from '@phosphor-icons/react';
import { useSyncExternalStore, type ReactNode } from 'react';

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

type ShortcutKey = 'undo' | 'redo' | 'random';

const isMac = () => typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);
const noSubscribe = () => () => {};

/** The platform's key names; the server (and hydration) renders the Ctrl spelling. */
function useShortcuts(): Record<ShortcutKey, string> {
  const mac = useSyncExternalStore(noSubscribe, isMac, () => false);
  return mac
    ? { undo: '⌘Z', redo: '⇧⌘Z', random: 'R' }
    : { undo: 'Ctrl Z', redo: 'Ctrl Y', random: 'R' };
}

const KEYSHORTCUTS: Record<ShortcutKey, string> = {
  undo: 'Control+Z Meta+Z',
  redo: 'Control+Shift+Z Meta+Shift+Z Control+Y',
  random: 'R',
};

/** A quiet icon button with its key written beside the icon (desktop only). */
function IconAction({
  label,
  shortcut,
  keys,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut: ShortcutKey;
  keys: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-keyshortcuts={KEYSHORTCUTS[shortcut]}
          disabled={disabled}
          onClick={onClick}
          className="group/action text-ink-muted hover:text-ink hover:bg-ink/[0.05] inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 transition-[background-color,color,scale] duration-200 active:scale-[0.96] active:duration-100 disabled:pointer-events-none disabled:opacity-35 lg:h-9 lg:justify-start lg:pr-2 lg:pl-2"
        >
          {children}
          <kbd className="border-hairline text-ink-faint group-hover/action:text-ink-muted hidden rounded-[5px] border px-1 py-px font-mono text-[10.5px] leading-tight tracking-[0.04em] whitespace-nowrap lg:inline">
            {keys}
          </kbd>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <kbd className="text-ink-faint ml-2 font-mono text-[11px]">{keys}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Pinned to the bottom of the panel: undo, redo and randomize as quiet keys
 * (each with its shortcut), and the ink "Bitti" pill that opens the premiere.
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
  const keys = useShortcuts();
  return (
    <footer className="border-hairline flex items-center gap-1 border-t px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:px-3.5 lg:pt-3 lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <IconAction
        label={labels.undo}
        shortcut="undo"
        keys={keys.undo}
        disabled={!canUndo || disabled}
        onClick={onUndo}
      >
        <ArrowCounterClockwiseIcon className="size-[18px]" aria-hidden="true" />
      </IconAction>
      <IconAction
        label={labels.redo}
        shortcut="redo"
        keys={keys.redo}
        disabled={!canRedo || disabled}
        onClick={onRedo}
      >
        <ArrowClockwiseIcon className="size-[18px]" aria-hidden="true" />
      </IconAction>
      <IconAction
        label={labels.randomize}
        shortcut="random"
        keys={keys.random}
        disabled={disabled}
        onClick={onRandomize}
      >
        <ShuffleIcon className="size-[18px]" aria-hidden="true" />
      </IconAction>
      <Button
        type="button"
        variant="primary"
        onClick={onDone}
        disabled={saving || disabled}
        aria-busy={saving || undefined}
        className="group/done ml-auto h-11 min-w-0 gap-2.5 pr-4.5 pl-5.5 text-[15px]"
      >
        {saving ? (
          <>
            <SpinnerGapIcon className="size-4 animate-spin" aria-hidden="true" />
            <span>{labels.saving}</span>
          </>
        ) : (
          <>
            {labels.done}
            <ArrowRightIcon
              weight="bold"
              aria-hidden="true"
              className="ease-out-expo size-4 transition-transform duration-300 group-hover/done:translate-x-1"
            />
          </>
        )}
      </Button>
    </footer>
  );
}
