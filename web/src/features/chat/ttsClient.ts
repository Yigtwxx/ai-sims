import { toVisemeEvents, type VisemeEvent } from '@/features/lipsync/azureVisemes';
import type { WordBoundary } from '@/features/lipsync/wordAlign';
import type { ChatLocale } from '@/lib/ai/types';
import type { TtsResponseBody, VoiceGender } from '@/lib/tts/types';
import { ApiFailure, failureFromResponse } from './chatClient';

export interface SpeechRequest {
  text: string;
  voice: VoiceGender;
  locale: ChatLocale;
}

/** A synthesized sentence, ready for `SpeechPlayer.load`. */
export interface SpeechClip {
  audio: ArrayBuffer;
  /** Oculus visemes from the voice's viseme events; empty when the voice has none. */
  visemes: VisemeEvent[];
  words: WordBoundary[];
  /** The text that was synthesized; the last resort for lip-sync. */
  text: string;
}

/** What `SpeechPlayer.load` accepts. */
export type SpeechScript = { events: VisemeEvent[] } | { words: WordBoundary[] } | { text: string };

/**
 * Best timing source first: exact viseme events when the voice emits them,
 * otherwise word boundaries, otherwise the text aligned to the audio.
 */
export function speechScript(clip: SpeechClip): SpeechScript {
  if (clip.visemes.length > 0) return { events: clip.visemes };
  if (clip.words.length > 0) return { words: clip.words };
  return { text: clip.text };
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** POSTs one sentence to `/api/tts`. Failures surface as `ApiFailure`. */
export async function fetchSpeechClip(
  request: SpeechRequest,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<SpeechClip> {
  let response: Response;
  try {
    response = await fetchFn('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiFailure('network');
  }
  if (!response.ok) throw await failureFromResponse(response, 'tts_not_configured');

  const body = (await response.json()) as TtsResponseBody;
  return {
    audio: base64ToArrayBuffer(body.audio),
    visemes: toVisemeEvents(body.visemes),
    words: body.words,
    text: request.text,
  };
}
