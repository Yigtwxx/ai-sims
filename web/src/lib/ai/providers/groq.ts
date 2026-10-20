import Groq, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'groq-sdk';
import { getAiEnv } from '@/lib/env';
import { isNetworkError, kindFromStatus, ProviderError } from '../errors';
import type { ChatProvider, ChatRequest } from '../types';

// Reasoning tokens count against max_completion_tokens, so keep headroom.
const MAX_COMPLETION_TOKENS = 2048;
const REQUEST_TIMEOUT_MS = 60_000;
// The SDK retries 408/409/429/5xx and connection errors with exponential backoff.
const MAX_RETRIES = 2;

export const groqProvider: ChatProvider = {
  id: 'groq',
  isConfigured: () => getAiEnv().groqApiKey !== undefined,
  stream: streamGroq,
};

/** `reasoning_effort` and `include_reasoning` are documented for the gpt-oss models. */
function isGptOss(model: string): boolean {
  return model.startsWith('openai/gpt-oss');
}

async function* streamGroq({ system, messages, signal }: ChatRequest): AsyncGenerator<string> {
  const { groqApiKey, groqModel } = getAiEnv();
  if (!groqApiKey) throw new ProviderError('groq', 'auth');

  const client = new Groq({
    apiKey: groqApiKey,
    maxRetries: MAX_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
  });

  let emitted = false;
  try {
    const stream = await client.chat.completions.create(
      {
        model: groqModel,
        messages: [{ role: 'system', content: system }, ...messages],
        stream: true,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        // Short, hidden reasoning keeps time-to-first-token low and the spoken text clean.
        ...(isGptOss(groqModel) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
      },
      { signal },
    );

    try {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (!text) continue;
        emitted = true;
        yield text;
      }
    } finally {
      // Ends the HTTP stream if the consumer left early; harmless once it is finished.
      stream.controller.abort();
    }
  } catch (error) {
    throw toProviderError(error);
  }

  if (!emitted) throw new ProviderError('groq', 'empty');
}

/** Maps the SDK's typed errors; the original (which may hold a response body) is dropped. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof APIUserAbortError) return new ProviderError('groq', 'aborted');
  if (error instanceof APIConnectionTimeoutError) return new ProviderError('groq', 'timeout');
  if (error instanceof APIConnectionError) return new ProviderError('groq', 'network');
  if (error instanceof APIError) {
    return new ProviderError('groq', kindFromStatus(error.status), error.status);
  }
  // A connection that dies mid-stream surfaces as a plain SDK error wrapping a socket error.
  if (isNetworkError(error)) return new ProviderError('groq', 'network');
  return new ProviderError('groq', 'unknown');
}
