'use client';

import { useEffect } from 'react';

import { writeLocalDraft } from './localDraft';
import { useCreatorStore } from './store';

/** Quiet period after the last edit before the tab's draft is rewritten. */
export const LOCAL_DRAFT_DELAY_MS = 300;

/**
 * While `active`, keeps the tab's local draft in step with the editor: each
 * name or config change is written after a short quiet period, and a pending
 * write goes out when the page is hidden (a reload or a closed tab). Turning
 * it off cancels a pending write, so a draft cleared at that moment stays
 * cleared.
 */
export function useLocalDraft(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    let timer: number | null = null;
    const write = () => {
      timer = null;
      const { name, config } = useCreatorStore.getState();
      writeLocalDraft({ name, config });
    };
    const flush = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      write();
    };
    const unsubscribe = useCreatorStore.subscribe((state, previous) => {
      if (state.config === previous.config && state.name === previous.name) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(write, LOCAL_DRAFT_DELAY_MS);
    });
    window.addEventListener('pagehide', flush);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active]);
}
