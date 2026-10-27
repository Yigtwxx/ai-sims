import { decodeSilhouette } from '@/lib/silhouette/format';

/** Sampled from a real MetaHuman by /dev/silhouette (see that page). */
export const SILHOUETTE_URL = '/assets/landing/silhouette.bin';

/** The silhouette's xyz triples, or undefined (the last shape then stays a sphere). */
export async function loadSilhouette(signal?: AbortSignal): Promise<Float32Array | undefined> {
  try {
    const response = await fetch(SILHOUETTE_URL, { signal });
    if (!response.ok) return undefined;
    return decodeSilhouette(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}
