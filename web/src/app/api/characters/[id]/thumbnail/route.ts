import { getSession } from '@/lib/auth/session';
import { getThumbnail } from '@/lib/characters/repository';

// Request-time route: the session cookie decides who may read the image.
export async function GET(request: Request, ctx: RouteContext<'/api/characters/[id]/thumbnail'>) {
  const user = await getSession();
  if (!user) return new Response(null, { status: 401 });

  const { id } = await ctx.params;
  // The query filters on userId, so someone else's thumbnail is indistinguishable from a missing one.
  const thumbnail = await getThumbnail(user.id, id);
  if (!thumbnail) return new Response(null, { status: 404 });

  const etag = `"${thumbnail.updatedAt.getTime()}"`;
  // `private`: the response depends on the session and must never sit in a shared cache.
  const headers = {
    'Cache-Control': 'private, max-age=0, must-revalidate',
    ETag: etag,
    Vary: 'Cookie',
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(thumbnail.data), {
    headers: { ...headers, 'Content-Type': thumbnail.contentType },
  });
}
