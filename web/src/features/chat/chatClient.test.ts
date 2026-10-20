// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ApiFailure, openChatStream, toChatMessages, type ApiFailureKind } from './chatClient';

const MESSAGES = [{ role: 'user', content: 'Merhaba' }] as const;

function textResponse(chunks: Uint8Array[], init: ResponseInit = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

const encode = (text: string) => new TextEncoder().encode(text);

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of chunks) out += chunk;
  return out;
}

describe('toChatMessages', () => {
  it('keeps the last 24 messages and cuts each to 2000 characters', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      role: 'user' as const,
      content: `${i}`.padEnd(3000, 'x'),
    }));
    const result = toChatMessages(many);
    expect(result).toHaveLength(24);
    expect(result[0]!.content.startsWith('6x')).toBe(true);
    expect(result.every((message) => message.content.length === 2000)).toBe(true);
  });
});

describe('openChatStream', () => {
  it('posts the conversation and returns the provider and the streamed text', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      textResponse([encode('Mer'), encode('haba!')], { headers: { 'X-AI-Provider': 'gemini' } }),
    );
    const controller = new AbortController();

    const stream = await openChatStream({
      messages: MESSAGES,
      locale: 'tr',
      characterId: 'char-1',
      signal: controller.signal,
      fetchFn,
    });

    expect(stream.provider).toBe('gemini');
    expect(await collect(stream.chunks)).toBe('Merhaba!');

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('/api/chat');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(controller.signal);
    expect(JSON.parse(init?.body as string)).toEqual({
      messages: [{ role: 'user', content: 'Merhaba' }],
      locale: 'tr',
      characterId: 'char-1',
    });
  });

  it('reassembles a multi-byte character that is split across chunks', async () => {
    const bytes = encode('Merhaba ğüşiöç 😊');
    const cut = bytes.indexOf(0xc4) + 1; // between the two bytes of "ğ"
    const fetchFn = vi.fn<typeof fetch>(async () =>
      textResponse([bytes.slice(0, cut), bytes.slice(cut, bytes.length - 2), bytes.slice(-2)]),
    );

    const stream = await openChatStream({ messages: MESSAGES, locale: 'tr', fetchFn });

    expect(await collect(stream.chunks)).toBe('Merhaba ğüşiöç 😊');
  });

  it('has no provider when the header is missing', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => textResponse([encode('x')]));
    expect((await openChatStream({ messages: MESSAGES, locale: 'en', fetchFn })).provider).toBe(
      undefined,
    );
  });

  describe('failures before any text', () => {
    const reply = (status: number, body: unknown) =>
      vi.fn<typeof fetch>(async () => Response.json(body, { status }));

    it.each<[string, number, unknown, ApiFailureKind]>([
      ['401', 401, { error: 'unauthenticated' }, 'unauthenticated'],
      ['503 ai_not_configured', 503, { error: 'ai_not_configured' }, 'not_configured'],
      ['503 for another reason', 503, { error: 'database_not_configured' }, 'unavailable'],
      ['502', 502, { error: 'ai_unavailable' }, 'unavailable'],
      ['400', 400, { error: 'invalid_request' }, 'invalid'],
      ['404', 404, { error: 'character_not_found' }, 'invalid'],
      ['413', 413, { error: 'payload_too_large' }, 'invalid'],
    ])('maps %s to %s', async (_name, status, body, kind) => {
      const error = await openChatStream({
        messages: MESSAGES,
        locale: 'tr',
        fetchFn: reply(status, body),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiFailure);
      expect((error as ApiFailure).kind).toBe(kind);
    });

    it('still maps by status when the error body is not JSON', async () => {
      const fetchFn = vi.fn<typeof fetch>(
        async () => new Response('<html>Bad gateway</html>', { status: 502 }),
      );
      const error = await openChatStream({ messages: MESSAGES, locale: 'tr', fetchFn }).catch(
        (e: unknown) => e,
      );
      expect((error as ApiFailure).kind).toBe('unavailable');
    });

    it('reports a network failure', async () => {
      const fetchFn = vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed');
      });
      const error = await openChatStream({ messages: MESSAGES, locale: 'tr', fetchFn }).catch(
        (e: unknown) => e,
      );
      expect((error as ApiFailure).kind).toBe('network');
    });

    it('lets an abort through unchanged', async () => {
      const controller = new AbortController();
      const abortError = new DOMException('Aborted', 'AbortError');
      const fetchFn = vi.fn<typeof fetch>(async () => {
        controller.abort();
        throw abortError;
      });
      await expect(
        openChatStream({ messages: MESSAGES, locale: 'tr', signal: controller.signal, fetchFn }),
      ).rejects.toBe(abortError);
    });
  });

  it('reports an interrupted reply when the connection breaks mid-stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode('Merha'));
      },
      pull(controller) {
        controller.error(new TypeError('terminated'));
      },
    });
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(stream));

    const opened = await openChatStream({ messages: MESSAGES, locale: 'tr', fetchFn });
    const received: string[] = [];
    const run = async () => {
      for await (const chunk of opened.chunks) received.push(chunk);
    };

    await expect(run()).rejects.toMatchObject({ kind: 'interrupted' });
    expect(received).toEqual(['Merha']);
  });
});
