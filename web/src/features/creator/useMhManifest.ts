'use client';

import { useCallback, useEffect, useState } from 'react';

import { assetUrl, loadMhManifest, type MhManifest } from '@/lib/assets/manifest';
import { loadTextureVariants } from '@/lib/assets/textureVariants';

export type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: MhManifest; fixture: boolean }
  /** No manifest on this machine yet (404): a setup state, not an error. */
  | { status: 'missing'; retry: () => void; fixtureAvailable: boolean }
  | { status: 'error'; retry: () => void };

const FIXTURES_ALLOWED = process.env.NODE_ENV !== 'production';

/** True when the page was opened with `?fixture=1` in development. */
export function wantsFixture(): boolean {
  if (!FIXTURES_ALLOWED || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fixture') === '1';
}

/**
 * Loads the MetaHuman manifest (curated by default). In development,
 * `?fixture=1` swaps in the fixture manifest so the creator, talk and curation
 * screens can be built and tested before the real export is on this machine.
 */
export function useMhManifest({ curated = true }: { curated?: boolean } = {}): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (wantsFixture()) {
          const { fixtureManifest } = await import('./fixtures/manifest');
          if (active) setState({ status: 'ready', manifest: fixtureManifest(), fixture: true });
          return;
        }
        // Phones read the texture index first: no map may load before its copy is known.
        const [manifest] = await Promise.all([loadMhManifest({ curated }), loadTextureVariants()]);
        if (active) setState({ status: 'ready', manifest, fixture: false });
      } catch (error) {
        if (!active) return;
        const missing = error instanceof Error && /\b404\b/.test(error.message);
        setState(
          missing
            ? { status: 'missing', retry, fixtureAvailable: FIXTURES_ALLOWED }
            : { status: 'error', retry },
        );
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [curated, attempt, retry]);

  return state;
}

/** Thumbnail URL for a manifest file; fixtures carry inline data URLs. */
export function thumbnailSrc(file: string | undefined): string | undefined {
  if (!file) return undefined;
  return file.startsWith('data:') ? file : assetUrl(file);
}
