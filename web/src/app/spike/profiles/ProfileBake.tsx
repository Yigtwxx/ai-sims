'use client';

import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useEffect, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { measureBodyProfile, type BodyProfile } from '@/features/avatar/vrm/fitDonor';
import type { ProfilesFile } from '@/features/avatar/vrm/profileSchema';
import { loadManifest } from '@/features/creator/manifest';

/**
 * Development tool: measures the body profile of every source model (from its
 * base VRM, which still has the skin) and writes profiles.json, which the
 * creator uses to fit parts from one model onto another. Open /spike/profiles
 * after the pipeline adds or changes sources.
 */
export function ProfileBake() {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState('starting');

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    void (async () => {
      const manifest = await loadManifest();
      const sources: Record<string, BodyProfile> = {};
      for (const [i, base] of manifest.bases.entries()) {
        if (cancelled) return;
        setStatus(`${i + 1}/${manifest.bases.length} ${base.source}`);
        const gltf = await loader.loadAsync(base.url);
        const vrm = gltf.userData.vrm as VRM;
        sources[base.source] = measureBodyProfile(vrm);
        const limbs = Object.keys(sources[base.source].limbs).length;
        setLog((l) => [
          ...l,
          `${base.source}: head ${sources[base.source].head ? 'ok' : '—'}, ${limbs} segments`,
        ]);
        VRMUtils.deepDispose(vrm.scene);
      }
      const file: ProfilesFile = { version: 1, sources };
      const response = await fetch('/api/dev/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(file),
      });
      if (!cancelled) setStatus(response.ok ? `DONE ${Object.keys(sources).length}` : 'ERROR');
    })().catch(() => !cancelled && setStatus('ERROR'));

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="bg-backstage text-ink min-h-dvh p-8 text-[13px]">
      <p data-testid="profile-status" className="mb-3 font-medium">
        {status}
      </p>
      <ol className="text-ink-muted space-y-1">
        {log.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </main>
  );
}
