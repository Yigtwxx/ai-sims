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
  disabled?: boolean;
}

/** The character's name as the title of the panel: display type, amber rule on focus. */
export const NameField = forwardRef<HTMLInputElement, NameFieldProps>(function NameField(
  { label, placeholder, value, maxLength, onChange, error, disabled },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;
  // The count is noise until it matters: shown while typing or near the limit.
  const nearLimit = value.length >= maxLength - 8;
  return (
    <div className="group/name px-6 pt-4 pb-5">
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor={id} className="text-label text-ink-muted font-medium">
          {label}
        </label>
        <span
          className={cn(
            'text-label tabular-nums transition-opacity duration-200 group-focus-within/name:opacity-100',
            nearLimit ? 'text-ink-muted opacity-100' : 'text-ink-faint opacity-0',
          )}
          aria-hidden="true"
        >
          {value.length}/{maxLength}
        </span>
      </div>
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
        aria-describedby={error ? errorId : undefined}
        className="font-display text-ink caret-marquee placeholder:text-ink-faint w-full bg-transparent text-[2rem] outline-none focus-visible:outline-none disabled:opacity-50 lg:text-[clamp(2.25rem,3vw,3rem)]"
      />
      <div className="bg-hairline relative mt-2 h-px">
        <span
          className={cn(
            'ease-out-expo absolute inset-0 origin-left transition-transform duration-500 group-focus-within/name:scale-x-100',
            error ? 'bg-alert scale-x-100' : 'bg-marquee scale-x-0',
          )}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-label text-alert mt-2">
          {error}
        </p>
      ) : null}
    </div>
  );
});
