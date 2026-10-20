'use client';

import { forwardRef, useId } from 'react';

interface NameFieldProps {
  label: string;
  placeholder: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  error?: string;
}

/** The character's name as the title of the page: display type, marquee underline on focus. */
export const NameField = forwardRef<HTMLInputElement, NameFieldProps>(function NameField(
  { label, placeholder, value, maxLength, onChange, error },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="group/name px-6 pt-7 pb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor={id} className="text-ink-muted text-[13px] font-medium">
          {label}
        </label>
        <span className="text-ink-faint text-[12px] tabular-nums">
          {value.length}/{maxLength}
        </span>
      </div>
      <input
        ref={ref}
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="font-display text-ink caret-marquee placeholder:text-ink-faint w-full bg-transparent text-[clamp(2.4rem,3.3vw,3.1rem)] leading-[0.95] outline-none focus-visible:outline-none"
      />
      <div className="bg-hairline relative mt-3 h-px">
        <span
          className={`bg-marquee ease-out-expo absolute inset-0 origin-left transition-transform duration-500 group-focus-within/name:scale-x-100 ${
            error ? 'bg-alert scale-x-100' : 'scale-x-0'
          }`}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-alert mt-2 text-[13px]">
          {error}
        </p>
      )}
    </div>
  );
});
