import { notFound } from 'next/navigation';

// This route only ever throws notFound(), so there is nothing to validate for
// instant navigation (the not-found UI itself is static).
export const instant = false;

/** Any unknown path under a locale renders the localized not-found screen inside the site chrome. */
export default function CatchAllPage() {
  notFound();
}
