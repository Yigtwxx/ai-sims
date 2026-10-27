'use client';

import { useSyncExternalStore } from 'react';

import type { QualityPreference } from '@/features/avatar/quality';

/*
 * The render quality picked over the creator stage, kept per browser. Storage
 * is only a convenience: when it is missing, blocked or holds something else,
 * the stage runs on auto and a pick still lasts for the visit (in memory).
 */

export const QUALITY_PREFERENCE_KEY = 'ai-sims.creator.quality';

/** Menu order: auto first (the default), then from the best look down. */
export const QUALITY_PREFERENCES = [
  'auto',
  'high',
  'balanced',
  'battery',
] as const satisfies readonly QualityPreference[];

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function parseQualityPreference(value: string | null | undefined): QualityPreference {
  return QUALITY_PREFERENCES.find((option) => option === value) ?? 'auto';
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readQualityPreference(
  storage: PreferenceStorage | null = browserStorage(),
): QualityPreference {
  try {
    return parseQualityPreference(storage?.getItem(QUALITY_PREFERENCE_KEY));
  } catch {
    return 'auto';
  }
}

export function writeQualityPreference(
  value: QualityPreference,
  storage: PreferenceStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(QUALITY_PREFERENCE_KEY, value);
  } catch {
    // Full or blocked storage: the pick holds for this visit only.
  }
}

let current: QualityPreference | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed it: follow along.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== QUALITY_PREFERENCE_KEY) return;
    current = parseQualityPreference(event.newValue);
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): QualityPreference {
  current ??= readQualityPreference();
  return current;
}

/** The server render (and hydration) always starts on auto. */
const getServerSnapshot = (): QualityPreference => 'auto';

function setQualityPreference(value: QualityPreference): void {
  current = value;
  writeQualityPreference(value);
  listeners.forEach((listener) => listener());
}

export function useQualityPreference(): [QualityPreference, (value: QualityPreference) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [value, setQualityPreference];
}
