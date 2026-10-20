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

/**
 * Models that accept `MINIMAL` thinking: every 3.x Flash-Lite plus gemini-3.5-flash and
 * gemini-3.6-flash. Checked against the API on 2026-10-20: gemini-3.7-flash, gemini-3.8-flash
 * and gemini-flash-latest answer `MINIMAL` with HTTP 400, while `LOW` is accepted by all of them.
 */
const MINIMAL_THINKING_MODELS = /^gemini-3(?:\.\d+)?-flash-lite|^gemini-3\.[56]-flash$/;

/**
 * Thinking level for a spoken reply, chosen per model because the accepted values differ.
 * `MINIMAL` spends no thinking tokens (first token in about 0.6 s on gemini-3.5-flash-lite,
 * against 2 s or more at `LOW` whenever it thinks); every other Gemini 3.x model gets the safe
 * `LOW`. Gemini 2.x models use `thinkingBudget` and aliases such as `gemini-flash-latest` change
 * under us, so those get the API default (undefined).
 */
export function thinkingLevelFor(model: string): ThinkingLevel | undefined {
  if (!/^gemini-3/.test(model)) return undefined;
  return MINIMAL_THINKING_MODELS.test(model) ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
}

async function* streamGemini({ system, messages, signal }: ChatRequest): AsyncGenerator<string> {
  const { geminiApiKey, geminiModel } = getAiEnv();
  if (!geminiApiKey) throw new ProviderError('gemini', 'auth');

  const ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: RETRY_OPTIONS },
  });

  const thinkingLevel = thinkingLevelFor(geminiModel);

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
        // Little or no thinking keeps time-to-first-token short for spoken replies.
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
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
