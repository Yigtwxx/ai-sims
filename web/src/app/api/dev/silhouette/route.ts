import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connection } from 'next/server';

import { devToolsEnabled } from '@/components/dev/devTools';
import { errorResponse } from '@/lib/http/responses';
import { decodeSilhouette } from '@/lib/silhouette/format';

/** The committed point file the landing silhouette reads (see lib/silhouette/format.ts). */
const TARGET = path.join(process.cwd(), 'public', 'assets', 'landing', 'silhouette.bin');
/** 8000 points take 48 KB; anything far past that is not a silhouette. */
const MAX_BYTES = 200 * 1024;

/**
 * POST /api/dev/silhouette with an `application/octet-stream` body in the
 * silhouette format: replaces public/assets/landing/silhouette.bin (written
 * to a temp file and renamed, so a failed write never leaves half a file).
 * `next dev` only, like the other asset benches.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!devToolsEnabled()) return new Response(null, { status: 404 });

  if (request.headers.get('content-type') !== 'application/octet-stream') {
    return errorResponse('unsupported_media_type', 415);
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return errorResponse('payload_too_large', 413);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return errorResponse('payload_too_large', 413);
  const points = decodeSilhouette(bytes);
  if (!points) return errorResponse('not_silhouette', 400);

  const temp = `${TARGET}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(path.dirname(TARGET), { recursive: true });
    await writeFile(temp, new Uint8Array(bytes));
    await rename(temp, TARGET);
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
    return errorResponse('silhouette_unwritable', 500);
  }

  return Response.json(
    {
      file: 'public/assets/landing/silhouette.bin',
      points: points.length / 3,
      bytes: bytes.byteLength,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
