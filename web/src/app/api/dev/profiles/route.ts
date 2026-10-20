import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ProfilesFileSchema } from '@/features/avatar/vrm/profileSchema';

/**
 * Development-only sink for the profile bake page: writes the body profiles
 * of every source model to public/assets/vrm/profiles.json. Disabled in
 * production builds.
 */

const MAX_BYTES = 2_000_000;

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });

  const text = await request.text();
  if (text.length > MAX_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = ProfilesFileSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: 'invalid_profiles' }, { status: 400 });

  const dir = path.join(process.cwd(), 'public', 'assets', 'vrm');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'profiles.json'), JSON.stringify(parsed.data));
  return Response.json({ ok: true, sources: Object.keys(parsed.data.sources).length });
}
