'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { CurationSchema } from '@/lib/assets/manifest';

const ENDPOINT = '/api/dev/curation';
const NONE: ReadonlySet<string> = new Set();

export type CurationLoad = 'loading' | 'ready' | 'error';

export interface CurationDraft {
  load: CurationLoad;
  /** Hidden ids as edited on screen (saved ids plus unsaved changes). */
  hidden: ReadonlySet<string>;
  /** Ids whose visibility differs from the saved curation. */
  changes: number;
  saving: boolean;
  setHidden: (ids: readonly string[], hide: boolean) => void;
  toggle: (id: string) => void;
  discard: () => void;
  /** Writes the draft; resolves false when the server refused or was unreachable. */
  save: () => Promise<boolean>;
  retry: () => void;
}

/**
 * The curation file behind /api/dev/curation, edited locally until saved. A
 * failed read keeps saving off, so an unreadable file is never overwritten
 * with a partial list.
 */
export function useCuration(): CurationDraft {
  const [load, setLoad] = useState<CurationLoad>('loading');
  const [saved, setSaved] = useState<ReadonlySet<string>>(NONE);
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch(ENDPOINT, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Curation request failed: ${response.status}`);
        const curation = CurationSchema.parse(await response.json());
        setSaved(new Set(curation.hidden));
        setLoad('ready');
      } catch {
        if (!controller.signal.aborted) setLoad('error');
      }
    };
    void read();
    return () => controller.abort();
  }, [attempt]);

  const hidden = draft ?? saved;

  const changes = useMemo(() => {
    let count = 0;
    for (const id of hidden) if (!saved.has(id)) count += 1;
    for (const id of saved) if (!hidden.has(id)) count += 1;
    return count;
  }, [hidden, saved]);

  const setHidden = useCallback(
    (ids: readonly string[], hide: boolean) => {
      setDraft((current) => {
        const next = new Set(current ?? saved);
        for (const id of ids) {
          if (hide) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [saved],
  );

  const toggle = useCallback(
    (id: string) => {
      setDraft((current) => {
        const next = new Set(current ?? saved);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [saved],
  );

  const discard = useCallback(() => setDraft(null), []);

  const save = useCallback(async () => {
    if (load !== 'ready') return false;
    setSaving(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: [...hidden] }),
      });
      if (!response.ok) return false;
      const curation = CurationSchema.parse(await response.json());
      setSaved(new Set(curation.hidden));
      setDraft(null);
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [hidden, load]);

  const retry = useCallback(() => {
    setLoad('loading');
    setAttempt((value) => value + 1);
  }, []);

  return { load, hidden, changes, saving, setHidden, toggle, discard, save, retry };
}
