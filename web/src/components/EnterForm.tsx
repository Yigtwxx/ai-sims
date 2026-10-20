'use client';

import { useActionState, useEffect, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  enterAction,
  type EnterDestination,
  type EnterState,
} from '@/components/session/enterAction';
import { cn } from '@/lib/utils';

interface EnterFormProps {
  /** Where to continue after signing in (or right away when already signed in). */
  next?: EnterDestination;
  /** Visible label; defaults to "Giriş". */
  children?: ReactNode;
  variant?: 'primary' | 'quiet' | 'ghost' | 'link';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  /** Also render the error under the button (toasts are always shown). */
  inlineError?: boolean;
  /** Wraps the submit button, e.g. in a magnetic field. */
  renderButton?: (button: ReactNode) => ReactNode;
}

/**
 * One-click anonymous sign-in. Errors surface as a toast (transient) and,
 * optionally, inline under the button for screen readers and slow readers.
 */
export function EnterForm({
  next = '/characters',
  children,
  variant = 'quiet',
  size = 'default',
  className,
  inlineError = false,
  renderButton,
}: EnterFormProps) {
  const t = useTranslations('Session');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<EnterState, FormData>(enterAction, null);
  const message = state?.error
    ? t(state.error === 'notConfigured' ? 'notConfigured' : 'signInFailed')
    : null;

  useEffect(() => {
    if (message) toast.error(message);
  }, [message, state]);

  const button = (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(pending && 'cursor-progress', className)}
    >
      {pending ? t('entering') : (children ?? t('enter'))}
    </Button>
  );

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      {renderButton ? renderButton(button) : button}
      {inlineError && message ? (
        <p role="alert" className="text-label text-alert mt-3 max-w-[46ch] leading-snug">
          {message}
        </p>
      ) : null}
    </form>
  );
}
