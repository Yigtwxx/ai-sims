'use client';

import {
  CheckCircleIcon,
  InfoIcon,
  SpinnerGapIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// Below this width the creator and talk screens stack, with their action bar
// (Bitti, the message box) pinned to the bottom edge.
const STACKED = '(max-width: 1023px)';

const subscribeStacked = (onChange: () => void) => {
  const query = window.matchMedia(STACKED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/*
 * shadcn/ui Sonner, adapted: the site is dark only, so the theme is fixed
 * (no next-themes) and the toast surface uses the backstage tokens. On
 * stacked layouts toasts drop in from the top so they never cover the
 * bottom action bar.
 */
function Toaster(props: ToasterProps) {
  const t = useTranslations('Status');
  const stacked = useSyncExternalStore(
    subscribeStacked,
    () => window.matchMedia(STACKED).matches,
    () => false,
  );

  return (
    <Sonner
      theme="dark"
      containerAriaLabel={t('notifications')}
      position={stacked ? 'top-center' : 'bottom-center'}
      offset={24}
      gap={10}
      className="toaster group"
      icons={{
        success: <CheckCircleIcon weight="fill" className="text-cobalt size-[18px]" />,
        info: <InfoIcon weight="fill" className="text-ink-muted size-[18px]" />,
        warning: <WarningIcon weight="fill" className="text-cobalt size-[18px]" />,
        error: <XCircleIcon weight="fill" className="text-alert size-[18px]" />,
        loading: <SpinnerGapIcon className="text-ink-muted size-[18px] animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'font-sans !rounded-control !border-hairline !bg-paper-raised !text-ink !shadow-[0_18px_40px_rgb(23_26_33/0.12)]',
          title: '!text-ui !font-semibold',
          description: '!text-label !text-ink-muted',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--color-paper-raised)',
          '--normal-text': 'var(--color-ink)',
          '--normal-border': 'var(--color-hairline)',
          '--border-radius': 'var(--radius-control)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
