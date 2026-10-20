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

const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Models that accept the server-side refusal fallback (`fallbacks: 'default'` plus the beta
 * above). Claude Haiku 5.5, the default, has none: with `'default'` a declined request just
 * stays declined and a model list is a 400, so it is sent without the beta and a refusal is
 * handled by the router like any other provider failure. Add a model here only after checking
 * https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#server-side-fallback
 */
const SERVER_SIDE_FALLBACK_MODELS: ReadonlySet<string> = new Set(['claude-opus-5-5']);

export function supportsServerSideFallback(model: string): boolean {
  return SERVER_SIDE_FALLBACK_MODELS.has(model);
}

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

  const params = {
    model: anthropicModel,
    max_tokens: MAX_TOKENS,
    system,
    messages: [...messages],
    // Claude Haiku 5.5 and Opus 5.5 think adaptively by default, so `thinking` stays unset
    // (`disabled` is a 400 on Opus 5.5 and Anthropic's guidance is to lower effort instead).
    // Low effort is the latency control. Never send temperature, top_p or top_k (400 on both
    // models) and never end `messages` with an assistant turn (prefill is a 400).
    output_config: { effort: 'low' as const },
  };

  // The beta endpoint is used only when a server-side fallback is actually available.
  const stream = supportsServerSideFallback(anthropicModel)
    ? client.beta.messages.stream(
        { ...params, betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: 'default' },
        { signal },
      )
    : client.messages.stream(params, { signal });

  let emitted = false;
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (!event.delta.text) continue;
        emitted = true;
        yield event.delta.text;
      }
    }

    // A refusal arrives as a normal 200 response (safety classifiers can decline); always check
    // before trusting the text. Nothing retries it server-side on the default model, and partial
    // text before a decline must not be treated as a complete reply.
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
