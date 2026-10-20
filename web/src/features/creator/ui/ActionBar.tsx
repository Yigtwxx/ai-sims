'use client';

import type { ReactNode } from 'react';

import { RedoIcon, ShuffleIcon, UndoIcon } from './icons';

interface ActionBarProps {
  labels: { undo: string; redo: string; randomize: string; done: string; saving: string };
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRandomize: () => void;
  onDone: () => void;
}

/** Pinned to the bottom of the wall: history controls, randomize, and the "Bitti" marquee. */
export function ActionBar({
  labels,
  canUndo,
  canRedo,
  saving,
  onUndo,
  onRedo,
  onRandomize,
  onDone,
}: ActionBarProps) {
  return (
    <footer className="border-hairline bg-backstage flex items-center gap-2 border-t px-6 py-4">
      <IconButton label={`${labels.undo} (⌘Z)`} onClick={onUndo} disabled={!canUndo}>
        <UndoIcon />
      </IconButton>
      <IconButton label={`${labels.redo} (⇧⌘Z)`} onClick={onRedo} disabled={!canRedo}>
        <RedoIcon />
      </IconButton>
      <IconButton label={`${labels.randomize} (R)`} onClick={onRandomize}>
        <ShuffleIcon />
      </IconButton>
      <button
        type="button"
        onClick={onDone}
        disabled={saving}
        className="rounded-control bg-marquee font-display text-backstage ease-out-expo hover:bg-marquee-deep relative ml-2 h-14 flex-1 overflow-hidden text-[1.65rem] transition-[background-color,scale] duration-300 active:scale-[0.985] disabled:cursor-progress"
      >
        <span className={`transition-opacity duration-200 ${saving ? 'opacity-0' : 'opacity-100'}`}>
          {labels.done}
        </span>
        {saving && (
          <span className="absolute inset-0 flex items-center justify-center gap-3 text-[1.1rem]">
            <span className="border-backstage/30 border-t-backstage h-4 w-4 animate-spin rounded-full border-2" />
            {labels.saving}
          </span>
        )}
      </button>
    </footer>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-control bg-backstage-raised text-ink hover:bg-backstage-lift disabled:text-ink-faint disabled:hover:bg-backstage-raised flex h-11 w-11 items-center justify-center transition-[background-color,color,scale] duration-200 active:scale-95 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
