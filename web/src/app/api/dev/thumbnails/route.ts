import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Development-only sink for the thumbnail bake page: writes poster art to
 * public/assets/vrm/thumbs. Disabled in production builds.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const PREFIX = 'data:image/webp;base64,';
const MAX_BYTES = 600_000;

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    dataUrl?: unknown;
  } | null;
  const id = body?.id;
  const dataUrl = body?.dataUrl;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return Response.json({ error: 'invalid_id' }, { status: 400 });
  }
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) {
    return Response.json({ error: 'invalid_image' }, { status: 400 });
  }
  const bytes = Buffer.from(dataUrl.slice(PREFIX.length), 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: 'invalid_size' }, { status: 400 });
  }

  const dir = path.join(process.cwd(), 'public', 'assets', 'vrm', 'thumbs');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.webp`), bytes);
  return Response.json({ ok: true, bytes: bytes.byteLength });
}
