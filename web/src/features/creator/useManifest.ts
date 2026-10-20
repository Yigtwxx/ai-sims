'use client';

import { useCallback, useEffect, useState } from 'react';

import { loadManifest, type VrmManifest } from './manifest';

type ManifestState =
  { status: 'loading' } | { status: 'ready'; manifest: VrmManifest } | { status: 'error' };

/** Loads the part manifest once, with a retry for transient failures. */
export function useManifest(): ManifestState & { retry: () => void } {
  const [state, setState] = useState<ManifestState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadManifest()
      .then((manifest) => {
        if (!cancelled) setState({ status: 'ready', manifest });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
