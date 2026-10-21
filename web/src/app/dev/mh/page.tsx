import { Suspense } from 'react';

import { DevMhViewer } from './DevMhViewer';

export default function DevMhPage() {
  return (
    <Suspense fallback={null}>
      <DevMhViewer />
    </Suspense>
  );
}
