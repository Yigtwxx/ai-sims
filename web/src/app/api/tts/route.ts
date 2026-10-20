import { getSession } from '@/lib/auth/session';
import { getTtsEnv } from '@/lib/env';
import { readJsonBody } from '@/lib/http/body';
import {
  CLIENT_CLOSED_REQUEST,
  errorResponse,
  invalidRequest,
  toRequestIssues,
} from '@/lib/http/responses';
import { TtsError } from '@/lib/tts/errors';
import { cleanSpeechText } from '@/lib/tts/speechText';
import type { TtsResponseBody } from '@/lib/tts/types';
import { TtsRequestSchema } from '@/lib/tts/ttsRequest';
import { speechProviders, synthesizeWithFallback } from '@/lib/tts/providers';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * POST /api/tts: synthesizes one piece of text and returns
 * `{ audio (base64), mime, visemes, words }` with times in seconds.
 * Providers are tried in TTS_PROVIDER_ORDER (default azure, edge, gemini); the one
 * that answered is reported in the `X-TTS-Provider` header.
 *
 * Runs on the Node.js runtime (the Speech SDK needs it). With Cache Components
 * that is the only runtime, so there is deliberately no `runtime` export.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getSession();
  if (!user) return errorResponse('unauthenticated', 401);

  const env = getTtsEnv();
  if (env.order.length === 0) return errorResponse('tts_not_configured', 503);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === 'too_large'
      ? errorResponse('payload_too_large', 413)
      : invalidRequest([{ path: 'body', message: 'Expected a JSON request body' }]);
  }

  const parsed = TtsRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest(toRequestIssues(parsed.error));

  // Emojis and markdown that slipped through the LLM would be read out loud.
  const text = cleanSpeechText(parsed.data.text);
  if (!text) return invalidRequest([{ path: 'text', message: 'Nothing speakable in the text' }]);

  try {
    const speech = await synthesizeWithFallback(env.order, speechProviders(env), {
      text,
      locale: parsed.data.locale,
      gender: parsed.data.voice,
      signal: request.signal,
    });

    const payload: TtsResponseBody = {
      audio: Buffer.from(speech.audio).toString('base64'),
      mime: speech.mime,
      visemes: speech.visemes,
      words: speech.words,
    };
    return Response.json(payload, {
      headers: { 'Cache-Control': 'no-store', 'X-TTS-Provider': speech.provider },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED_REQUEST });
    // Only the coarse kind is logged: SDK error details can echo request data.
    console.error('[api/tts] synthesis failed', {
      kind: error instanceof TtsError ? error.kind : 'unknown',
    });
    return errorResponse('tts_unavailable', 502);
  }
}
