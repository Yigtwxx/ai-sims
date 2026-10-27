import { describe, expect, it } from 'vitest';

import {
  QUALITY_PREFERENCE_KEY,
  parseQualityPreference,
  readQualityPreference,
  writeQualityPreference,
  type PreferenceStorage,
} from './qualityPreference';

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const blocked: PreferenceStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('quality preference', () => {
  it('accepts only known tiers', () => {
    expect(parseQualityPreference('battery')).toBe('battery');
    expect(parseQualityPreference('ultra')).toBe('auto');
    expect(parseQualityPreference(null)).toBe('auto');
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    writeQualityPreference('balanced', storage);
    expect(storage.getItem(QUALITY_PREFERENCE_KEY)).toBe('balanced');
    expect(readQualityPreference(storage)).toBe('balanced');
  });

  it('falls back to auto without storage or with a stale value', () => {
    expect(readQualityPreference(null)).toBe('auto');
    expect(readQualityPreference(memoryStorage({ [QUALITY_PREFERENCE_KEY]: 'max' }))).toBe('auto');
  });

  it('never throws when storage is blocked', () => {
    expect(readQualityPreference(blocked)).toBe('auto');
    expect(() => writeQualityPreference('high', blocked)).not.toThrow();
  });
});
