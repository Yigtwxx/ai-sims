import 'server-only';
import type { ChatLocale } from '@/lib/ai/types';
import { DEFAULT_TTS_VOICES, type TtsEnv, type TtsProviderId } from '@/lib/env';
import { synthesizeSpeech } from './azure';
import { synthesizeWithEdge } from './edge';
import { TtsError } from './errors';
import { synthesizeWithGemini } from './gemini';
import type { TtsViseme, TtsWord, VoiceGender } from './types';
import { resolveVoice } from './voices';

export interface SpeechRequest {
  text: string;
  locale: ChatLocale;
  gender: VoiceGender;
  signal?: AbortSignal;
}

export interface SpeechResult {
  provider: TtsProviderId;
  audio: Uint8Array;
  mime: string;
  visemes: TtsViseme[];
  words: TtsWord[];
}

export type SpeechProvider = (request: SpeechRequest) => Promise<Omit<SpeechResult, 'provider'>>;

/** Provider implementations for an env; only configured providers get an entry. */
export function speechProviders(env: TtsEnv): Partial<Record<TtsProviderId, SpeechProvider>> {
  const providers: Partial<Record<TtsProviderId, SpeechProvider>> = {};
  const { azure, gemini } = env;
  if (azure) {
    providers.azure = async ({ text, locale, gender, signal }) => {
      const voice = resolveVoice(azure, locale, gender);
      return synthesizeSpeech({
        text,
        voice: voice.name,
        language: voice.language,
        key: azure.key,
        region: azure.region,
        signal,
      });
    };
  }
  if (env.edgeEnabled) {
    providers.edge = async ({ text, locale, gender, signal }) => {
      // Edge serves the same neural voices; reuse the Azure voice choice when configured.
      const voices = azure?.voices ?? DEFAULT_TTS_VOICES;
      const speech = await synthesizeWithEdge({ text, voice: voices[locale][gender], signal });
      return { ...speech, visemes: [] };
    };
  }
  if (gemini) {
    providers.gemini = async ({ text, gender, signal }) => {
      const speech = await synthesizeWithGemini({ text, gender, ...gemini, signal });
      return { ...speech, visemes: [], words: [] };
    };
  }
  return providers;
}

/**
 * Tries providers in order and returns the first success. A failure moves on to
 * the next provider; an aborted request stops immediately. Only failure kinds are
 * logged, never request text or provider responses.
 */
export async function synthesizeWithFallback(
  order: readonly TtsProviderId[],
  providers: Partial<Record<TtsProviderId, SpeechProvider>>,
  request: SpeechRequest,
): Promise<SpeechResult> {
  let lastError: TtsError = new TtsError('unknown');
  for (const id of order) {
    const provider = providers[id];
    if (!provider) continue;
    try {
      return { provider: id, ...(await provider(request)) };
    } catch (error) {
      lastError = error instanceof TtsError ? error : new TtsError('unknown');
      if (lastError.kind === 'aborted' || request.signal?.aborted) throw new TtsError('aborted');
      console.warn('[tts] provider failed', { provider: id, kind: lastError.kind });
    }
  }
  throw lastError;
}
