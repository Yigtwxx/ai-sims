import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { fontVariables } from '@/styles/fonts';
import '../globals.css';

export const metadata: Metadata = { title: 'AI Sims dev', robots: { index: false } };

/** Developer benches (renderer inspection, thumbnails). Not part of the product. */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <html lang="en" className={`${fontVariables} dark h-full`}>
      <body className="bg-backstage text-ink h-full overflow-hidden">{children}</body>
    </html>
  );
}
