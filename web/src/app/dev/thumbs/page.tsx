import en from '../../../../messages/en.json';

import { ThumbsBench } from './ThumbsBench';

/** Thumbnail renders for faces and grooms (dev layout: `next dev` only). */
export default function DevThumbsPage() {
  // The dev root has no locale routing; the bench reads its strings in English.
  return <ThumbsBench messages={{ DevThumbs: en.DevThumbs }} />;
}
