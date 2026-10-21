import { constants } from 'node:fs';
import { access, copyFile, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connection } from 'next/server';

import { devToolsEnabled } from '@/components/dev/devTools';
import {
  isSafeThumbnailPath,
  isWebp,
  THUMBNAIL_FILE,
  thumbnailTargets,
  type ThumbTarget,
} from '@/components/dev/thumbTargets';
import { MhManifestSchema, type MhManifest } from '@/lib/assets/manifest';
import { errorResponse } from '@/lib/http/responses';

/** The asset root the manifest paths are relative to (a junction to the archive's web folder). */
const ASSET_ROOT = path.join(process.cwd(), 'public', 'assets', 'mh');
const MAX_BYTES = 1024 * 1024;

const exists = (file: string) =>
  access(file, constants.F_OK).then(
    () => true,
    () => false,
  );

async function readManifest(): Promise<MhManifest> {
  return MhManifestSchema.parse(
    JSON.parse(await readFile(path.join(ASSET_ROOT, 'manifest.json'), 'utf8')),
  );
}

/**
 * The absolute path for a target, or null when it would leave the asset root.
 * Checked twice: lexically, then with junctions and links resolved, against the
 * real root. The folder must already exist (it holds the asset itself).
 */
async function resolveTarget(target: ThumbTarget): Promise<string | null> {
  if (!isSafeThumbnailPath(target.file)) return null;
  const lexical = path.resolve(ASSET_ROOT, ...target.file.split('/'));
  const relative = path.relative(ASSET_ROOT, lexical);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    const [root, folder] = await Promise.all([
      realpath(ASSET_ROOT),
      realpath(path.dirname(lexical)),
    ]);
    if (folder !== root && !folder.startsWith(root + path.sep)) return null;
    return path.join(folder, THUMBNAIL_FILE);
  } catch {
    return null;
  }
}

/**
 * GET /api/dev/thumbnails: every face and groom with its thumbnail path,
 * whether the manifest names that path, and whether the file and a `.bak`
 * exist. `next dev` only.
 */
export async function GET(): Promise<Response> {
  await connection();
  if (!devToolsEnabled()) return new Response(null, { status: 404 });
  let manifest: MhManifest;
  try {
    manifest = await readManifest();
  } catch {
    return errorResponse('manifest_unreadable', 500);
  }
  const items = await Promise.all(
    thumbnailTargets(manifest).map(async (target) => {
      const file = await resolveTarget(target);
      return {
        ...target,
        exists: file ? await exists(file) : false,
        backup: file ? await exists(`${file}.bak`) : false,
        writable: file !== null,
      };
    }),
  );
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/dev/thumbnails?id=<manifest id> with a WebP body: writes the
 * item's thumbnail.webp. The path comes from the manifest, never the client;
 * the first overwrite keeps the original as thumbnail.webp.bak. `next dev` only.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!devToolsEnabled()) return new Response(null, { status: 404 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return errorResponse('missing_id', 400);
  if (request.headers.get('content-type') !== 'image/webp') {
    return errorResponse('unsupported_media_type', 415);
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return errorResponse('payload_too_large', 413);
  }

  let manifest: MhManifest;
  try {
    manifest = await readManifest();
  } catch {
    return errorResponse('manifest_unreadable', 500);
  }
  const target = thumbnailTargets(manifest).find((candidate) => candidate.id === id);
  if (!target) return errorResponse('unknown_id', 404);
  const file = await resolveTarget(target);
  if (!file) return errorResponse('unsafe_path', 400);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return errorResponse('payload_too_large', 413);
  if (!isWebp(bytes)) return errorResponse('not_webp', 400);

  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  let backedUp = false;
  try {
    if ((await exists(file)) && !(await exists(`${file}.bak`))) {
      await copyFile(file, `${file}.bak`, constants.COPYFILE_EXCL);
      backedUp = true;
    }
    await writeFile(temp, bytes);
    await rename(temp, file);
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
    return errorResponse('thumbnail_unwritable', 500);
  }

  return Response.json(
    { id, file: target.file, inManifest: target.inManifest, bytes: bytes.byteLength, backedUp },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
