import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connection } from 'next/server';
import { z } from 'zod';

import { devToolsEnabled } from '@/components/dev/devTools';
import { CurationSchema } from '@/lib/assets/manifest';
import { readJsonBody } from '@/lib/http/body';
import { errorResponse, invalidRequest, toRequestIssues } from '@/lib/http/responses';

/** Where the curation lives: next to the manifest it filters (served at /assets/mh/curation.json). */
const CURATION_FILE = path.join(process.cwd(), 'public', 'assets', 'mh', 'curation.json');
const MAX_BODY_BYTES = 512 * 1024;

const HiddenIds = z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/)).max(20_000);

async function readCuration() {
  try {
    return CurationSchema.parse(JSON.parse(await readFile(CURATION_FILE, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hidden: [] };
    throw error;
  }
}

/** GET /api/dev/curation: the hidden ids. `next dev` only; a 404 otherwise. */
export async function GET(): Promise<Response> {
  await connection();
  if (!devToolsEnabled()) return new Response(null, { status: 404 });
  try {
    return Response.json(await readCuration(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return errorResponse('curation_unreadable', 500);
  }
}

/**
 * PUT /api/dev/curation: replaces the hidden ids. Validated with
 * CurationSchema and written atomically (temp file + rename). `next dev`
 * only: the file changes the catalogue for everyone, and `next start` would not
 * serve a file added to public/ after the build anyway.
 */
export async function PUT(request: Request): Promise<Response> {
  await connection();
  if (!devToolsEnabled()) return new Response(null, { status: 404 });

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === 'too_large'
      ? errorResponse('payload_too_large', 413)
      : invalidRequest([{ path: 'body', message: 'Expected a JSON request body' }]);
  }
  const parsed = CurationSchema.extend({ hidden: HiddenIds }).safeParse(body.value);
  if (!parsed.success) {
    return invalidRequest(toRequestIssues(parsed.error));
  }

  const curation = { hidden: [...new Set(parsed.data.hidden)].sort() };
  const temp = `${CURATION_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(path.dirname(CURATION_FILE), { recursive: true });
    await writeFile(temp, `${JSON.stringify(curation, null, 2)}\n`, 'utf8');
    await rename(temp, CURATION_FILE);
  } catch {
    return errorResponse('curation_unwritable', 500);
  }
  return Response.json(curation, { headers: { 'Cache-Control': 'no-store' } });
}
