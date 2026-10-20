import {
  AiNotConfiguredError,
  AiUnavailableError,
  ProviderError,
  toFailure,
  type ProviderFailure,
} from './errors';
import { getOrderedProviders } from './providers';
import type { ChatProvider, ChatRequest, ProviderId } from './types';

/** How long one provider may take to produce its first token before the next one is tried. */
export const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 25_000;

export interface FallbackStream {
  /** The provider that produced the first token. */
  provider: ProviderId;
  /** The first chunk (already received) followed by the rest of the reply. */
  stream: AsyncIterable<string>;
}

export interface StreamWithFallbackOptions {
  /** Defaults to the providers in AI_PROVIDER_ORDER. Unconfigured ones are skipped. */
  providers?: readonly ChatProvider[];
  firstTokenTimeoutMs?: number;
}

/**
 * Starts a reply on the first provider that works.
 *
 * A provider is abandoned only while it has produced no text: auth errors,
 * 429, 5xx, network failures, refusals before any text, empty replies and
 * first-token timeouts all move on to the next provider. The returned promise
 * resolves with the first token in hand, so the caller can still answer with
 * a proper HTTP error status. Once it resolves the choice is final: a failure
 * later in the stream is thrown to the consumer, never retried elsewhere,
 * because the user has already seen (and possibly heard) part of the reply.
 *
 * @throws AiNotConfiguredError when no provider has credentials.
 * @throws AiUnavailableError when every configured provider failed.
 */
export async function streamWithFallback(
  request: ChatRequest,
  options: StreamWithFallbackOptions = {},
): Promise<FallbackStream> {
  const providers = (options.providers ?? getOrderedProviders()).filter((provider) =>
    provider.isConfigured(),
  );
  if (providers.length === 0) throw new AiNotConfiguredError();

  const timeoutMs = options.firstTokenTimeoutMs ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS;
  const failures: ProviderFailure[] = [];

  for (const provider of providers) {
    // The caller already left: do not spend another provider on it.
    request.signal?.throwIfAborted();

    const attempt = await startAttempt(provider, request, timeoutMs);
    if (attempt.ok) return attempt.value;
    failures.push(attempt.failure);
  }
  throw new AiUnavailableError(failures);
}

type Attempt = { ok: true; value: FallbackStream } | { ok: false; failure: ProviderFailure };

async function startAttempt(
  provider: ChatProvider,
  request: ChatRequest,
  timeoutMs: number,
): Promise<Attempt> {
  // Each attempt gets its own signal so a stalled provider can be cancelled without
  // touching the caller's signal; the caller's abort is forwarded into it.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', forwardAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const release = () => {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', forwardAbort);
  };

  let iterator: AsyncIterator<string> | undefined;
  try {
    iterator = provider.stream({ ...request, signal: controller.signal })[Symbol.asyncIterator]();

    // Raced against a timer so a provider that ignores the abort signal cannot hang the request.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new ProviderError(provider.id, 'timeout'));
      }, timeoutMs);
    });
    const firstChunk = nextChunk(iterator);
    firstChunk.catch(() => undefined); // may lose the race; its rejection is then irrelevant
    const first = await Promise.race([firstChunk, deadline]);
    clearTimeout(timer);

    if (first === undefined) throw new ProviderError(provider.id, 'empty');
    return { ok: true, value: { provider: provider.id, stream: relay(iterator, first, release) } };
  } catch (error) {
    release();
    closeQuietly(iterator);
    if (request.signal?.aborted) throw error; // the caller left; surface it, don't fail over

    const failure: ProviderFailure = timedOut
      ? { provider: provider.id, kind: 'timeout' }
      : toFailure(provider.id, error);
    // Only the provider, the coarse kind and the status are logged, never a message or body.
    console.warn('[ai] provider failed before its first token', failure);
    return { ok: false, failure };
  }
}

/** Next non-empty chunk, or undefined when the provider finished without any text. */
async function nextChunk(iterator: AsyncIterator<string>): Promise<string | undefined> {
  for (;;) {
    const result = await iterator.next();
    if (result.done) return undefined;
    if (result.value) return result.value;
  }
}

/** Yields the first chunk, then the rest. Leaving early cancels the upstream request. */
async function* relay(
  iterator: AsyncIterator<string>,
  first: string,
  release: () => void,
): AsyncGenerator<string> {
  try {
    yield first;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      if (next.value) yield next.value;
    }
  } finally {
    release();
    closeQuietly(iterator);
  }
}

/** Fire-and-forget `return()`: a hung provider must not block cleanup. */
function closeQuietly(iterator: AsyncIterator<string> | undefined): void {
  if (!iterator?.return) return;
  try {
    Promise.resolve(iterator.return()).catch(() => undefined);
  } catch {
    // already closed
  }
}
