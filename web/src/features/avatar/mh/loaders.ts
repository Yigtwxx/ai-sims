'use client';

import { useLoader, useThree } from '@react-three/fiber';
import { LoadingManager, type WebGLRenderer } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { textureUrl } from '@/lib/assets/textureVariants';

/** Basis transcoder copied from three/examples/jsm/libs/basis into public/basis. */
const BASIS_PATH = '/basis/';

// One KTX2Loader per renderer: it owns a transcoder worker pool and detects the
// GPU's compressed formats (ASTC/BC7/ETC2) once.
const ktx2ByRenderer = new Map<WebGLRenderer, KTX2Loader>();

// Every KTX2 request, the maps glTF files reference included, resolves through
// this manager: on phones it swaps in the phone-sized copies.
const ktx2Manager = new LoadingManager();
ktx2Manager.setURLModifier(textureUrl);

/**
 * Terminates the transcoder workers of renderers whose canvas has left the
 * page. The pool otherwise outlives its renderer, and pages that mount many
 * stages in turn (thumbnails, curation previews) pile up workers until loads
 * time out. Cleaning up when the next renderer arrives, rather than on unmount,
 * keeps React's development double mount from killing a pool in use.
 */
function releaseDetachedLoaders(): void {
  for (const [renderer, loader] of ktx2ByRenderer) {
    if (renderer.domElement.isConnected) continue;
    loader.dispose();
    ktx2ByRenderer.delete(renderer);
  }
}

export function ktx2LoaderFor(renderer: WebGLRenderer): KTX2Loader {
  let loader = ktx2ByRenderer.get(renderer);
  if (!loader) {
    releaseDetachedLoaders();
    loader = new KTX2Loader(ktx2Manager).setTranscoderPath(BASIS_PATH).detectSupport(renderer);
    ktx2ByRenderer.set(renderer, loader);
  }
  return loader;
}

/** Meshopt decoder workers; the KTX2 transcoder keeps a pool of the same size. */
const MESHOPT_WORKERS = 4;
let meshoptWorkers = false;

/**
 * The meshopt decoder, decoding in a worker pool. Without one, every GLB's
 * buffers are decoded on the main thread as it is parsed (a head, its hair
 * cards and each garment stall the stage for tens to hundreds of ms).
 */
export function meshoptDecoder(): typeof MeshoptDecoder {
  if (!meshoptWorkers && typeof Worker !== 'undefined') {
    // Not a React hook despite the name (the linter would take it for one).
    const startWorkers = MeshoptDecoder.useWorkers;
    startWorkers(MESHOPT_WORKERS);
    meshoptWorkers = true;
  }
  return MeshoptDecoder;
}

/** Configures a GLTFLoader for MetaHuman assets: KTX2 textures and meshopt geometry. */
export function configureLoader(loader: GLTFLoader, renderer: WebGLRenderer): void {
  loader.setKTX2Loader(ktx2LoaderFor(renderer));
  loader.setMeshoptDecoder(meshoptDecoder());
}

/**
 * Suspends until the GLB is loaded. R3F caches results by URL, so the same head
 * or outfit is parsed once; callers clone before mutating.
 */
export function useMhGltf(url: string): GLTF {
  const gl = useThree((state) => state.gl);
  return useLoader(GLTFLoader, url, (loader) => configureLoader(loader, gl));
}

/** Like useMhGltf for several GLBs at once (none: no suspension). */
export function useMhGltfs(urls: readonly string[]): GLTF[] {
  const gl = useThree((state) => state.gl);
  return useLoader(GLTFLoader, urls as string[], (loader) => configureLoader(loader, gl));
}

/** Starts loading without suspending, e.g. for the options next to the current one. */
export function preloadMhGltf(url: string, renderer: WebGLRenderer): void {
  useLoader.preload(GLTFLoader, url, (loader) => configureLoader(loader, renderer));
}

/** Drops a GLB from the cache once nothing on screen uses it any more. */
export function evictMhGltf(url: string): void {
  useLoader.clear(GLTFLoader, url);
}
