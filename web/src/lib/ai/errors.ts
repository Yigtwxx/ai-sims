import type { ProviderId } from './types';

/**
 * Error types for the AI layer.
 *
 * Provider SDK errors can carry request ids and raw response bodies, so they
 * are converted to `ProviderError` at the provider boundary and the original is
 * dropped. Only the provider id, a coarse `kind` and the HTTP status travel
 * further (to logs and to the router).
 */

export type ProviderFailureKind =
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'bad_request'
  | 'refusal'
  | 'empty'
  | 'aborted'
  | 'unknown';

export interface ProviderFailure {
  provider: ProviderId;
  kind: ProviderFailureKind;
  status?: number;
}

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly kind: ProviderFailureKind;
  readonly status: number | undefined;

  constructor(provider: ProviderId, kind: ProviderFailureKind, status?: number) {
    super(`${provider} request failed: ${kind}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}

/** No provider has credentials (or none is listed in AI_PROVIDER_ORDER). */
export class AiNotConfiguredError extends Error {
  constructor() {
    super('No AI provider is configured: set ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY');
    this.name = 'AiNotConfiguredError';
  }
}

/** Every configured provider failed before producing its first token. */
export class AiUnavailableError extends Error {
  readonly failures: readonly ProviderFailure[];

  constructor(failures: readonly ProviderFailure[]) {
    super(`All AI providers failed: ${failures.map((f) => `${f.provider}:${f.kind}`).join(', ')}`);
    this.name = 'AiUnavailableError';
    this.failures = failures;
  }
}

/** Maps an HTTP status to a failure kind; `undefined` means no response was received. */
export function kindFromStatus(status: number | undefined): ProviderFailureKind {
  if (status === undefined) return 'network';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * True for transport-level failures (a dropped connection, DNS, timeouts) as
 * raised by `fetch`/undici. SDKs often wrap them in their own error class, so
 * the `cause` chain is searched too.
 */
export function isNetworkError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
    if (current instanceof TypeError && /fetch failed|terminated|network/i.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Reduces anything thrown by a provider to a loggable, secret-free failure. */
export function toFailure(provider: ProviderId, error: unknown): ProviderFailure {
  if (error instanceof ProviderError) {
    return { provider, kind: error.kind, ...(error.status ? { status: error.status } : {}) };
  }
  return { provider, kind: 'unknown' };
}
