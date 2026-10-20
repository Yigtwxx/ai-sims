import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getAiEnv } from '@/lib/env';
import { isAbortError, isNetworkError, kindFromStatus, ProviderError } from '../errors';
import type { ChatProvider, ChatRequest } from '../types';

const MAX_OUTPUT_TOKENS = 2048;
const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_OPTIONS = {
  // Original request plus two retries, like the other providers. Delays are in seconds.
  attempts: 3,
  initialDelay: 0.5,
  maxDelay: 4,
} as const;

const BLOCKING_FINISH_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

export const geminiProvider: ChatProvider = {
  id: 'gemini',
  isConfigured: () => getAiEnv().geminiApiKey !== undefined,
  stream: streamGemini,
};

/** Gemini 3.x models take `thinkingLevel`; older ones use `thinkingBudget`, which we leave alone. */
function usesThinkingLevel(model: string): boolean {
  return /^gemini-3/.test(model);
}

async function* streamGemini({ system, messages, signal }: ChatRequest): AsyncGenerator<string> {
  const { geminiApiKey, geminiModel } = getAiEnv();
  if (!geminiApiKey) throw new ProviderError('gemini', 'auth');

  const ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: RETRY_OPTIONS },
  });

  let emitted = false;
  let blocked = false;
  try {
    const stream = await ai.models.generateContentStream({
      model: geminiModel,
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      config: {
        systemInstruction: system,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: signal,
        // `low` keeps time-to-first-token short for spoken replies.
        ...(usesThinkingLevel(geminiModel)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      },
    });

    for await (const chunk of stream) {
      // The prompt itself was rejected; no candidates follow.
      if (chunk.promptFeedback?.blockReason) throw new ProviderError('gemini', 'refusal');

      const text = chunk.text;
      if (text) {
        emitted = true;
        yield text;
      }
      const finishReason = chunk.candidates?.[0]?.finishReason;
      if (finishReason && BLOCKING_FINISH_REASONS.has(finishReason)) blocked = true;
    }
  } catch (error) {
    throw toProviderError(error);
  }

  if (blocked) throw new ProviderError('gemini', 'refusal');
  if (!emitted) throw new ProviderError('gemini', 'empty');
}

/** Maps SDK and transport errors; the original (which may hold a response body) is dropped. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (isAbortError(error)) return new ProviderError('gemini', 'aborted');
  if (error instanceof ApiError) {
    return new ProviderError('gemini', kindFromStatus(error.status), error.status);
  }
  if (isNetworkError(error)) return new ProviderError('gemini', 'network');
  return new ProviderError('gemini', 'unknown');
}
