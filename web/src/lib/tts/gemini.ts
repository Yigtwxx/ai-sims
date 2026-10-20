import 'server-only';
import { ApiError, GoogleGenAI } from '@google/genai';
import { TtsError } from './errors';
import type { VoiceGender } from './types';

/**
 * Gemini text-to-speech, the last fallback: natural voices with an existing key,
 * but no timing data and a small free daily quota. It returns raw 16-bit PCM,
 * which is wrapped in a WAV header so the browser's decodeAudioData accepts it.
 */

const SAMPLE_RATE = 24_000;
const DEFAULT_TIMEOUT_MS = 25_000;

export const GEMINI_SPEECH_MIME = 'audio/wav';

/** Prebuilt Gemini voices that read Turkish and English well. */
const VOICES: Record<VoiceGender, string> = { female: 'Kore', male: 'Charon' };

export interface GeminiSynthesizeParams {
  text: string;
  gender: VoiceGender;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GeminiSpeech {
  audio: Uint8Array;
  mime: typeof GEMINI_SPEECH_MIME;
}

/** RIFF/WAVE header for mono 16-bit little-endian PCM. */
export function wrapPcmAsWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  const wav = new Uint8Array(44 + pcm.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}

function kindOf(error: unknown): TtsError {
  if (error instanceof TtsError) return error;
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return new TtsError('auth');
    if (error.status === 429) return new TtsError('rate_limit');
    if (error.status === 400) return new TtsError('bad_request');
    return new TtsError('service');
  }
  return new TtsError('network');
}

export async function synthesizeWithGemini(params: GeminiSynthesizeParams): Promise<GeminiSpeech> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });
  const timeout = AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
  try {
    const response = await ai.models.generateContent({
      model: params.model,
      contents: [{ role: 'user', parts: [{ text: params.text }] }],
      config: {
        abortSignal: signal,
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[params.gender] } },
        },
      },
    });
    const data = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)
      ?.inlineData?.data;
    if (!data) throw new TtsError('service');
    return {
      audio: wrapPcmAsWav(new Uint8Array(Buffer.from(data, 'base64'))),
      mime: GEMINI_SPEECH_MIME,
    };
  } catch (error) {
    if (params.signal?.aborted) throw new TtsError('aborted');
    if (timeout.aborted) throw new TtsError('timeout');
    throw kindOf(error);
  }
}
