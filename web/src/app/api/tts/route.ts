import { getSession } from '@/lib/auth/session';
import { getAzureSpeechEnv } from '@/lib/env';
import { readJsonBody } from '@/lib/http/body';
import {
  CLIENT_CLOSED_REQUEST,
  errorResponse,
  invalidRequest,
  toRequestIssues,
} from '@/lib/http/responses';
import { synthesizeSpeech } from '@/lib/tts/azure';
import { TtsError } from '@/lib/tts/errors';
import { cleanSpeechText } from '@/lib/tts/speechText';
import type { TtsResponseBody } from '@/lib/tts/types';
import { TtsRequestSchema } from '@/lib/tts/ttsRequest';
import { resolveVoice } from '@/lib/tts/voices';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * POST /api/tts: synthesizes one piece of text with Azure Speech and returns
 * `{ audio (base64 MP3), mime, visemes, words }` with times in seconds.
 *
 * Runs on the Node.js runtime (the Speech SDK needs it). With Cache Components
 * that is the only runtime, so there is deliberately no `runtime` export.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getSession();
  if (!user) return errorResponse('unauthenticated', 401);

  const azure = getAzureSpeechEnv();
  if (!azure) return errorResponse('tts_not_configured', 503);

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

  const voice = resolveVoice(azure, parsed.data.locale, parsed.data.voice);
  try {
    const speech = await synthesizeSpeech({
      text,
      voice: voice.name,
      language: voice.language,
      key: azure.key,
      region: azure.region,
      signal: request.signal,
    });

    const payload: TtsResponseBody = {
      audio: Buffer.from(speech.audio).toString('base64'),
      mime: speech.mime,
      visemes: speech.visemes,
      words: speech.words,
    };
    return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED_REQUEST });
    // Only the coarse kind is logged: SDK error details can echo request data.
    console.error('[api/tts] synthesis failed', {
      kind: error instanceof TtsError ? error.kind : 'unknown',
    });
    return errorResponse('tts_unavailable', 502);
  }
}
