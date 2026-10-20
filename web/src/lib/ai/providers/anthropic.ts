import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';
import { getAiEnv } from '@/lib/env';
import { isNetworkError, kindFromStatus, ProviderError } from '../errors';
import type { ChatProvider, ChatRequest } from '../types';

// Thinking tokens count against max_tokens even though their text is not
// returned, so leave generous headroom for a 1-4 sentence spoken reply.
const MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 60_000;
// The SDK retries 408/409/429/5xx and connection errors with exponential backoff.
const MAX_RETRIES = 2;

export const anthropicProvider: ChatProvider = {
  id: 'anthropic',
  isConfigured: () => getAiEnv().anthropicApiKey !== undefined,
  stream: streamClaude,
};

async function* streamClaude({ system, messages, signal }: ChatRequest): AsyncGenerator<string> {
  const { anthropicApiKey, anthropicModel } = getAiEnv();
  if (!anthropicApiKey) throw new ProviderError('anthropic', 'auth');

  const client = new Anthropic({
    apiKey: anthropicApiKey,
    maxRetries: MAX_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
  });

  const stream = client.beta.messages.stream(
    {
      model: anthropicModel,
      max_tokens: MAX_TOKENS,
      system,
      messages: [...messages],
      // Claude Opus 5.5 always thinks: `thinking: {type: "disabled"}` is a 400 and so is a
      // trailing assistant message (prefill). Effort is the latency control.
      output_config: { effort: 'low' },
      // Server-side refusal fallback: a classifier decline is retried on Anthropic's
      // recommended model inside the same call instead of coming back as a refusal.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );

  let emitted = false;
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (!event.delta.text) continue;
        emitted = true;
        yield event.delta.text;
      }
    }

    // A refusal arrives as a normal 200 response; always check before trusting the text.
    // Without a fallback model the whole chain declined; partial text must not be treated as complete.
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new ProviderError('anthropic', 'refusal');
    if (!emitted) throw new ProviderError('anthropic', 'empty');
  } catch (error) {
    throw toProviderError(error);
  } finally {
    // No-op once the stream has ended; cancels the upstream request when the consumer leaves early.
    if (!stream.ended) stream.abort();
  }
}

/** Maps the SDK's typed errors; the original (which may hold a response body) is dropped. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof APIUserAbortError) return new ProviderError('anthropic', 'aborted');
  if (error instanceof APIConnectionTimeoutError) return new ProviderError('anthropic', 'timeout');
  if (error instanceof APIConnectionError) return new ProviderError('anthropic', 'network');
  if (error instanceof APIError) {
    return new ProviderError('anthropic', kindFromStatus(error.status), error.status);
  }
  // A connection that dies mid-stream surfaces as a plain SDK error wrapping a socket error.
  if (isNetworkError(error)) return new ProviderError('anthropic', 'network');
  return new ProviderError('anthropic', 'unknown');
}
