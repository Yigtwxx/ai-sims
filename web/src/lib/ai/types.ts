/**
 * Provider-neutral chat types. This module has no imports on purpose, so it is
 * safe to load from tests, route handlers and env parsing alike.
 */

export const PROVIDER_IDS = ['anthropic', 'gemini', 'groq'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** UI languages the companion speaks. Mirrors `routing.locales` in `src/i18n/routing.ts`. */
export const CHAT_LOCALES = ['en', 'tr'] as const;
export type ChatLocale = (typeof CHAT_LOCALES)[number];

/** Request limits shared by `POST /api/chat` and its browser client. */
export const MAX_CHAT_MESSAGES = 24;
export const MAX_CHAT_MESSAGE_CHARS = 2000;

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  /** System prompt, already rendered for the character and locale. */
  system: string;
  /** Conversation so far; must start and end with a user message (see `normalizeConversation`). */
  messages: readonly ChatMessage[];
  /** Aborts the upstream request, e.g. when the browser disconnects. */
  signal?: AbortSignal;
}

export interface ChatProvider {
  readonly id: ProviderId;
  /** True when the provider has the credentials it needs. Never calls the network. */
  isConfigured(): boolean;
  /**
   * Streams the reply as plain text deltas. Must throw (a `ProviderError`
   * where possible) when the model refuses or returns no text at all, so the
   * router can move on to the next provider.
   */
  stream(request: ChatRequest): AsyncIterable<string>;
}
