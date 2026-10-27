'use client';

import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils';

interface NameFieldProps {
  label: string;
  placeholder: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  error?: string;
  /** A quiet line under the field (where an unnamed draft is kept). */
  note?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The character's name at the head of the panel: a mono kicker over the name
 * itself, the count on the name's baseline, and a hairline that draws in
 * cobalt while it is edited.
 */
export const NameField = forwardRef<HTMLInputElement, NameFieldProps>(function NameField(
  { label, placeholder, value, maxLength, onChange, error, note, disabled, className },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;
  // The count is noise until it matters: shown while typing or near the limit.
  const nearLimit = value.length >= maxLength - 8;
  const describedBy = error ? errorId : note ? noteId : undefined;
  return (
    <div className={cn('group/name min-w-0', className)}>
      <label
        htmlFor={id}
        className="text-ink-faint block truncate font-mono text-[11px] leading-tight tracking-[0.12em] uppercase"
      >
        {label}
      </label>
      <div className="mt-1.5 flex items-baseline gap-3">
        <input
          ref={ref}
          id={id}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className="text-ink caret-cobalt placeholder:text-ink-faint/70 min-w-0 flex-1 truncate bg-transparent text-[1.3125rem] leading-tight font-medium tracking-[-0.015em] outline-none focus-visible:outline-none disabled:opacity-50"
        />
        <span
          className={cn(
            'shrink-0 font-mono text-[11px] tabular-nums transition-opacity duration-200 group-focus-within/name:opacity-100',
            nearLimit ? 'text-ink-muted opacity-100' : 'text-ink-faint opacity-0',
          )}
          aria-hidden="true"
        >
          {value.length}/{maxLength}
        </span>
      </div>
      <div className="bg-hairline relative mt-2 h-px">
        <span
          className={cn(
            'ease-out-expo absolute inset-0 origin-left transition-transform duration-500 group-focus-within/name:scale-x-100',
            error ? 'bg-alert scale-x-100' : 'bg-cobalt scale-x-0',
          )}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-label text-alert mt-1.5">
          {error}
        </p>
      ) : note ? (
        <p id={noteId} className="text-ink-faint mt-1.5 text-[12px] leading-snug">
          {note}
        </p>
      ) : null}
    </div>
  );
});
