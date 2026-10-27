import { Suspense } from 'react';

import { SilhouetteBench } from './SilhouetteBench';

/** Samples the landing silhouette points from a real character (dev layout: `next dev` only). */
export default function DevSilhouettePage() {
  return (
    <Suspense fallback={null}>
      <SilhouetteBench />
    </Suspense>
  );
}
