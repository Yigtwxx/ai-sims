import { ChatRequestSchema } from '@/lib/ai/chatRequest';
import { normalizeConversation } from '@/lib/ai/conversation';
import { AiNotConfiguredError, AiUnavailableError, toFailure } from '@/lib/ai/errors';
import { buildSystemPrompt } from '@/lib/ai/persona';
import { hasConfiguredProvider } from '@/lib/ai/providers';
import { streamWithFallback } from '@/lib/ai/router';
import { toTextStream } from '@/lib/ai/textStream';
import { getSession } from '@/lib/auth/session';
import { getCharacter } from '@/lib/characters/repository';
import { readJsonBody } from '@/lib/http/body';
import {
  CLIENT_CLOSED_REQUEST,
  errorResponse,
  invalidRequest,
  toRequestIssues,
} from '@/lib/http/responses';

// 24 messages of 2000 characters fit in well under this, even with JSON escaping.
const MAX_BODY_BYTES = 512 * 1024;

/**
 * POST /api/chat: streams the companion's reply as plain UTF-8 text.
 *
 * Runs on the Node.js runtime. With Cache Components that is the only runtime,
 * so there is deliberately no `runtime` export (it is rejected there).
 *
 * Order matters: session (401), then "no provider configured" (503) so a bare
 * curl shows the real blocker, then the body (400/413), then the character (404).
 * Once the first token is in hand the status is 200 and the provider is final.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getSession();
  if (!user) return errorResponse('unauthenticated', 401);
  if (!hasConfiguredProvider()) return errorResponse('ai_not_configured', 503);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === 'too_large'
      ? errorResponse('payload_too_large', 413)
      : invalidRequest([{ path: 'body', message: 'Expected a JSON request body' }]);
  }

  const parsed = ChatRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest(toRequestIssues(parsed.error));

  const messages = normalizeConversation(parsed.data.messages);
  if (!messages) {
    return invalidRequest([
      { path: 'messages', message: 'The conversation must end with a user message' },
    ]);
  }

  // Scoped by the session's user id: someone else's character looks like a missing one.
  const { characterId, locale } = parsed.data;
  const character = characterId ? await getCharacter(user.id, characterId) : undefined;
  if (characterId && !character) return errorResponse('character_not_found', 404);

  try {
    const { provider, stream } = await streamWithFallback({
      system: buildSystemPrompt({ character: character ?? undefined, locale }),
      messages,
      signal: request.signal,
    });

    const textStream = toTextStream(stream, (error) => {
      // After the first token the status is already sent; log what we can, without details.
      if (!request.signal.aborted) {
        console.error('[api/chat] reply interrupted', toFailure(provider, error));
      }
    });
    return new Response(textStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
        'X-AI-Provider': provider,
      },
    });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return errorResponse('ai_not_configured', 503);
    if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED_REQUEST });
    if (error instanceof AiUnavailableError) {
      console.error('[api/chat] all providers failed', error.failures);
      return errorResponse('ai_unavailable', 502);
    }
    throw error;
  }
}
