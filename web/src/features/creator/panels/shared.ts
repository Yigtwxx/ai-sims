'use client';

import { useLocale } from 'next-intl';
import { useCallback } from 'react';

import { labelFor, type MhManifest } from '@/lib/assets/manifest';

import { useCreatorStore } from '../store';

export interface PanelProps {
  manifest: MhManifest;
}

/** Resolves manifest labels ({tr, en} or plain) for the active locale. */
export function useLabel() {
  const locale = useLocale();
  return useCallback((label: Parameters<typeof labelFor>[0]) => labelFor(label, locale), [locale]);
}

/** The config and its undoable updater. */
export function useConfig() {
  const config = useCreatorStore((state) => state.config);
  const update = useCreatorStore((state) => state.update);
  return { config, update };
}

/** Signed -1..1 value as a short human readout: "+24%", "-8%", or the neutral word. */
export function signedPercent(value: number, neutral: string): string {
  const percent = Math.round(value * 100);
  if (percent === 0) return neutral;
  return percent > 0 ? `+${percent}%` : `${percent}%`;
}
