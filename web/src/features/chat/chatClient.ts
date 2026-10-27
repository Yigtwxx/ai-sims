import {
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_MESSAGES,
  type ChatLocale,
  type ChatMessage,
} from '@/lib/ai/types';

/** Why a chat or TTS request failed, in terms the UI can explain. */
export type ApiFailureKind =
  | 'unauthenticated'
  | 'not_configured'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid'
  | 'network'
  | 'interrupted';

export class ApiFailure extends Error {
  readonly kind: ApiFailureKind;

  constructor(kind: ApiFailureKind) {
    super(`Request failed: ${kind}`);
    this.name = 'ApiFailure';
    this.kind = kind;
  }
}

async function readErrorCode(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return body?.error;
  } catch {
    return undefined; // not JSON, e.g. a proxy error page
  }
}

/**
 * Maps an error response of `/api/chat` or `/api/tts` to a failure kind. The
 * server answers with `{ error: <code> }`; the status alone is enough for most.
 */
export async function failureFromResponse(
  response: Response,
  notConfiguredCode: string,
): Promise<ApiFailure> {
  const code = await readErrorCode(response);

  if (response.status === 401) return new ApiFailure('unauthenticated');
  if (response.status === 503 && code === notConfiguredCode)
    return new ApiFailure('not_configured');
  // Our daily quota; a provider's own 429 reaches the client as a 502.
  if (response.status === 429 && code === 'rate_limited') return new ApiFailure('rate_limited');
  if (response.status >= 500) return new ApiFailure('unavailable');
  if (response.status >= 400) return new ApiFailure('invalid');
  return new ApiFailure('unavailable');
}

/** Keeps the request inside the server's limits: the last 24 messages, 2000 characters each. */
export function toChatMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_CHAT_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_CHAT_MESSAGE_CHARS),
  }));
}

export interface OpenChatStreamParams {
  messages: readonly ChatMessage[];
  locale: ChatLocale;
  characterId?: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export interface ChatStream {
  /** Which provider answered (`X-AI-Provider`), when the server says. */
  provider: string | undefined;
  /** The reply as it is written. Throws an `ApiFailure('interrupted')` if the connection breaks. */
  chunks: AsyncGenerator<string, void, void>;
}

/**
 * POSTs the conversation to `/api/chat` and returns once the reply starts, so
 * errors (401, 503, 502, ...) surface as an `ApiFailure` before any text.
 */
export async function openChatStream(params: OpenChatStreamParams): Promise<ChatStream> {
  const { messages, locale, characterId, signal, fetchFn = fetch } = params;

  let response: Response;
  try {
    response = await fetchFn('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: toChatMessages(messages), locale, characterId }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiFailure('network');
  }

  if (!response.ok) throw await failureFromResponse(response, 'ai_not_configured');
  if (!response.body) throw new ApiFailure('unavailable');

  return {
    provider: response.headers.get('X-AI-Provider') ?? undefined,
    chunks: readText(response.body, signal),
  };
}

async function* readText(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` keeps a multi-byte character that is split across chunks intact.
      const text = decoder.decode(value, { stream: true });
      if (text) yield text;
    }
    const rest = decoder.decode();
    if (rest) yield rest;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiFailure('interrupted');
  } finally {
    try {
      await reader.cancel();
    } catch {
      // the stream already failed or closed
    }
  }
}
