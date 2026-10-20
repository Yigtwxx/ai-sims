'use client';

import {
  CheckCircleIcon,
  InfoIcon,
  SpinnerGapIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/*
 * shadcn/ui Sonner, adapted: the site is dark only, so the theme is fixed
 * (no next-themes) and the toast surface uses the backstage tokens.
 */
function Toaster(props: ToasterProps) {
  const t = useTranslations('Status');

  return (
    <Sonner
      theme="dark"
      containerAriaLabel={t('notifications')}
      position="bottom-center"
      offset={24}
      gap={10}
      className="toaster group"
      icons={{
        success: <CheckCircleIcon weight="fill" className="text-marquee size-[18px]" />,
        info: <InfoIcon weight="fill" className="text-ink-muted size-[18px]" />,
        warning: <WarningIcon weight="fill" className="text-marquee size-[18px]" />,
        error: <XCircleIcon weight="fill" className="text-alert size-[18px]" />,
        loading: <SpinnerGapIcon className="text-ink-muted size-[18px] animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'font-sans !rounded-control !border-hairline !bg-backstage-raised !text-ink !shadow-[0_18px_40px_rgb(5_5_4/0.55)]',
          title: '!text-ui !font-semibold',
          description: '!text-label !text-ink-muted',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--color-backstage-raised)',
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
