import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { fontVariables } from '@/styles/fonts';

import '../globals.css';

export const metadata: Metadata = {
  title: 'Realism spike',
  robots: { index: false },
};

/** Standalone root layout: the spike lives outside the i18n app shell. */
export default function SpikeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="h-dvh overflow-hidden bg-[#f2f1ee] antialiased">{children}</body>
    </html>
  );
}
