import 'server-only';

/**
 * Asset tools (curation, thumbnail renders) write into the MetaHuman asset
 * archive, so they exist under `next dev` only. A production build returns 404
 * for them whatever the environment says: there is no flag to turn them on.
 */
export function devToolsEnabled(): boolean {
  return process.env.NODE_ENV === 'development';
}
