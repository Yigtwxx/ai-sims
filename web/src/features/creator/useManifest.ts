'use client';

import { useCallback, useEffect, useState } from 'react';

import { loadManifest, loadProfiles, type SourceProfiles, type VrmManifest } from './manifest';

type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: VrmManifest; profiles: SourceProfiles }
  | { status: 'error' };

/** Loads the part manifest (and body profiles) once, with a retry for transient failures. */
export function useManifest(): ManifestState & { retry: () => void } {
  const [state, setState] = useState<ManifestState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadManifest(), loadProfiles()])
      .then(([manifest, profiles]) => {
        if (!cancelled) setState({ status: 'ready', manifest, profiles });
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
