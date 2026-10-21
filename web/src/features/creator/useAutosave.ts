'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CharacterStatus } from '@/lib/characters/repository';
import { saveCharacterAction, type SaveCharacterResult } from '@/lib/characters/saveActions';

import { snapshotOf, useCreatorStore } from './store';

/** Quiet period after the last edit before the draft is written. */
const DEBOUNCE_MS = 1400;

export type AutosaveStatus = 'idle' | 'needsName' | 'pending' | 'saving' | 'saved' | 'error';

export type SaveOutcome = SaveCharacterResult | { ok: false; error: 'needsName' };

interface AutosaveOptions {
  /** Off until the manifest is loaded and the editor is ready. */
  enabled: boolean;
  /** Existing character id; undefined until the first save creates it. */
  id: string | undefined;
  /** The status the character keeps (a finalized character stays finalized). */
  status: CharacterStatus;
  onCreated: (id: string) => void;
}

export interface Autosave {
  status: AutosaveStatus;
  savedAt: Date | null;
  /** The character id, once a save has created it. */
  idRef: { readonly current: string | undefined };
  /** Cancels a pending debounce and waits for a save that is already running. */
  flush: () => Promise<void>;
  /**
   * Saves the store as it is now, after any running save (so the second save
   * reuses the id the first one created). Marks exactly the sent snapshot saved.
   */
  save: (status: CharacterStatus) => Promise<SaveOutcome>;
}

/**
 * Debounced draft autosave through `saveCharacterAction`. Saves never overlap:
 * one runs at a time, and the next one starts with the id the previous one
 * returned, so a new character is created once. Nameless drafts are not
 * written (the repository requires a name). A pending change is saved when the
 * editor unmounts, and leaving the page while dirty asks first.
 */
export function useAutosave({ enabled, id, status, onCreated }: AutosaveOptions): Autosave {
  const name = useCreatorStore((state) => state.name);
  const config = useCreatorStore((state) => state.config);
  const savedSnapshot = useCreatorStore((state) => state.savedSnapshot);
  const idRef = useRef(id);
  const inFlight = useRef<Promise<SaveOutcome> | null>(null);
  const timer = useRef<number | null>(null);
  const mounted = useRef(false);
  const latest = useRef({ enabled, status, onCreated });
  const [saving, setSaving] = useState(false);
  /** Consecutive failed saves; retries back off with it. */
  const [failures, setFailures] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    latest.current = { enabled, status, onCreated };
  }, [enabled, status, onCreated]);

  useEffect(() => {
    if (id) idRef.current = id;
  }, [id]);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const save = useCallback(async (saveStatus: CharacterStatus): Promise<SaveOutcome> => {
    // Wait for the running save; its id is then in idRef. Re-check in a loop:
    // another caller may have started the next save in the meantime.
    while (inFlight.current) await inFlight.current.catch(() => undefined);

    const state = useCreatorStore.getState();
    const trimmed = state.name.trim();
    if (!trimmed) return { ok: false, error: 'needsName' };
    const sent = snapshotOf(state.name, state.config);

    const run = (async (): Promise<SaveOutcome> => {
      const result = await saveCharacterAction({
        id: idRef.current,
        name: trimmed,
        config: state.config,
        status: saveStatus,
      }).catch((): SaveCharacterResult => ({ ok: false, error: 'failed' }));
      if (result.ok) {
        useCreatorStore.getState().markSaved(sent);
        if (!idRef.current) {
          idRef.current = result.id;
          if (mounted.current) latest.current.onCreated(result.id);
        }
      }
      if (mounted.current) {
        setFailures((count) => (result.ok ? 0 : count + 1));
        if (result.ok) setSavedAt(new Date());
      }
      return result;
    })();

    inFlight.current = run;
    setSaving(true);
    try {
      return await run;
    } finally {
      if (inFlight.current === run) inFlight.current = null;
      if (mounted.current) setSaving(inFlight.current !== null);
    }
  }, []);

  const flush = useCallback(async () => {
    cancelTimer();
    while (inFlight.current) await inFlight.current.catch(() => undefined);
  }, [cancelTimer]);

  const current = snapshotOf(name, config);
  const dirty = enabled && Boolean(name.trim()) && savedSnapshot !== current;

  // Debounce: each edit restarts the quiet period; the save itself never
  // overlaps another. A failed save is retried, backing off up to 16x.
  useEffect(() => {
    if (!dirty) return undefined;
    cancelTimer();
    timer.current = window.setTimeout(
      () => {
        timer.current = null;
        void save(latest.current.status);
      },
      DEBOUNCE_MS * 2 ** Math.min(failures, 4),
    );
    return cancelTimer;
  }, [dirty, current, failures, save, cancelTimer]);

  // Leaving the editor (client navigation) still writes a pending change.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const state = useCreatorStore.getState();
      const pending =
        latest.current.enabled &&
        state.name.trim() &&
        state.savedSnapshot !== snapshotOf(state.name, state.config);
      if (pending) void save(latest.current.status);
    };
  }, [save]);

  // Closing or reloading the tab with unsaved work asks first.
  useEffect(() => {
    if (!dirty && !saving) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, saving]);

  let state: AutosaveStatus = 'idle';
  if (!enabled) state = 'idle';
  else if (!name.trim()) state = 'needsName';
  else if (saving) state = 'saving';
  else if (failures > 0) state = 'error';
  else if (savedSnapshot !== current) state = 'pending';
  else if (savedAt) state = 'saved';

  return { status: state, savedAt, idRef, flush, save };
}
