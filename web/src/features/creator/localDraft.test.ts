import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig } from '@/lib/character/defaults';
import { CURRENT_SCHEMA_VERSION } from '@/lib/character/schema';

import {
  LOCAL_DRAFT_KEY,
  clearLocalDraft,
  createRestoreGate,
  documentRevisited,
  readLocalDraft,
  writeLocalDraft,
  type DraftStorage,
} from './localDraft';
import { useCreatorStore } from './store';
import { LOCAL_DRAFT_DELAY_MS, useLocalDraft } from './useLocalDraft';

const envelope = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 1,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: '',
    config: createDefaultConfig('male'),
    ...overrides,
  });

/** Storage whose every call throws, as in a browser with site data blocked. */
const blocked: DraftStorage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

describe('local draft storage', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('round-trips a nameless draft with its config', () => {
    const config = createDefaultConfig('male');
    config.skin.tone = 0.25;
    writeLocalDraft({ name: '', config });
    expect(readLocalDraft()).toEqual({ name: '', config });
  });

  it('stamps the stored draft with the config schema version', () => {
    writeLocalDraft({ name: 'Ada', config: createDefaultConfig('female') });
    const stored = JSON.parse(window.sessionStorage.getItem(LOCAL_DRAFT_KEY) ?? '{}');
    expect(stored).toMatchObject({ format: 1, schemaVersion: CURRENT_SCHEMA_VERSION, name: 'Ada' });
  });

  it('returns null when nothing is stored', () => {
    expect(readLocalDraft()).toBeNull();
  });

  it.each([
    ['broken JSON', '{"format":1,'],
    ['an unknown envelope format', envelope({ format: 2 })],
    ['a config that fails the schema', envelope({ config: { base: 'robot' } })],
    ['a newer schema version', envelope({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })],
    ['a missing name', envelope({ name: undefined })],
  ])('drops %s instead of restoring it', (_, raw) => {
    window.sessionStorage.setItem(LOCAL_DRAFT_KEY, raw);
    expect(readLocalDraft()).toBeNull();
    expect(window.sessionStorage.getItem(LOCAL_DRAFT_KEY)).toBeNull();
  });

  it('migrates a draft written under an older config schema', () => {
    const v1 = {
      schemaVersion: 1,
      style: 'anime',
      base: 'female',
      face: { preset: 'fem_vroid__base', blend: {} },
      skin: { tone: 0 },
      eyes: { color: '#ffffff' },
      hair: { style: 'AvatarSample_B__hair', color: '#ffffff' },
      facialHair: { style: null, color: '#ffffff' },
      outfit: {
        top: { id: 'AvatarSample_B__top', color: '#ffffff' },
        bottom: { id: 'AvatarSample_B__bottom', color: '#ffffff' },
        shoes: { id: 'AvatarSample_B__shoes', color: '#ffffff' },
      },
      body: { build: 'curvy', height: 1.04 },
      accessories: ['earring_hoop'],
      tattoos: [],
    };
    window.sessionStorage.setItem(LOCAL_DRAFT_KEY, envelope({ schemaVersion: 1, config: v1 }));
    const draft = readLocalDraft();
    expect(draft?.config.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(draft?.config).toMatchObject({ base: 'female', accessories: ['earring_hoop'] });
  });

  it('clears the draft', () => {
    writeLocalDraft({ name: '', config: createDefaultConfig('female') });
    clearLocalDraft();
    expect(readLocalDraft()).toBeNull();
  });

  it('never throws when storage is blocked or missing', () => {
    const draft = { name: '', config: createDefaultConfig('female') };
    expect(() => writeLocalDraft(draft, blocked)).not.toThrow();
    expect(readLocalDraft(blocked)).toBeNull();
    expect(() => clearLocalDraft(blocked)).not.toThrow();
    expect(readLocalDraft(null)).toBeNull();
    expect(() => writeLocalDraft(draft, null)).not.toThrow();
  });
});

describe('documentRevisited', () => {
  const here = { href: 'http://localhost:3000/tr/create?fixture=1' };

  it('is true for a reload or history visit of the current page', () => {
    const name = 'http://localhost:3000/tr/create';
    expect(documentRevisited({ type: 'reload', name }, here)).toBe(true);
    expect(documentRevisited({ type: 'back_forward', name }, here)).toBe(true);
  });

  it('is false for a fresh visit, another page or no timing entry', () => {
    expect(
      documentRevisited({ type: 'navigate', name: 'http://localhost:3000/tr/create' }, here),
    ).toBe(false);
    expect(
      documentRevisited({ type: 'reload', name: 'http://localhost:3000/tr/characters' }, here),
    ).toBe(false);
    expect(documentRevisited(undefined, here)).toBe(false);
  });
});

describe('createRestoreGate', () => {
  it('lets only the first editor visit of the document restore, and only after a reload', () => {
    const gate = createRestoreGate(() => true);
    expect(gate('_b_1_')).toBe(true);
    // StrictMode remount and back/forward keep the visit id.
    expect(gate('_b_1_')).toBe(true);
    // A later in-app visit to the creator starts a new character.
    expect(gate('_b_2_')).toBe(false);

    const fresh = createRestoreGate(() => false);
    expect(fresh('_b_1_')).toBe(false);
  });
});

describe('useLocalDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    useCreatorStore.setState({ name: '', config: createDefaultConfig('female') });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('writes edits after a short quiet period', () => {
    renderHook(() => useLocalDraft(true));
    act(() => useCreatorStore.getState().update((draft) => void (draft.skin.tone = 0.5)));
    expect(readLocalDraft()).toBeNull();
    act(() => vi.advanceTimersByTime(LOCAL_DRAFT_DELAY_MS));
    expect(readLocalDraft()?.config.skin.tone).toBe(0.5);
  });

  it('writes a pending edit when the page is hidden', () => {
    renderHook(() => useLocalDraft(true));
    act(() => useCreatorStore.getState().setName('Zuri'));
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(readLocalDraft()?.name).toBe('Zuri');
  });

  it('does nothing while inactive, and drops a pending write when switched off', () => {
    const hook = renderHook(({ active }) => useLocalDraft(active), {
      initialProps: { active: false },
    });
    act(() => useCreatorStore.getState().setName('Omari'));
    act(() => vi.advanceTimersByTime(LOCAL_DRAFT_DELAY_MS));
    expect(readLocalDraft()).toBeNull();

    hook.rerender({ active: true });
    act(() => useCreatorStore.getState().setName('Omari 2'));
    // The character got its server copy: the draft is cleared and must stay so.
    hook.rerender({ active: false });
    clearLocalDraft();
    act(() => vi.advanceTimersByTime(LOCAL_DRAFT_DELAY_MS));
    expect(readLocalDraft()).toBeNull();
  });
});
