// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { toTextStream } from './textStream';

async function* gen(...values: string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    out += decoder.decode(value, { stream: true });
  }
}

describe('toTextStream', () => {
  it('encodes the chunks as UTF-8 in order', async () => {
    const stream = toTextStream(gen('Merhaba, ', 'dünya ğüşiöç ', '😊'), vi.fn());
    expect(await readAll(stream)).toBe('Merhaba, dünya ğüşiöç 😊');
  });

  it('closes cleanly for an empty source', async () => {
    expect(await readAll(toTextStream(gen(), vi.fn()))).toBe('');
  });

  it('reports a mid-stream failure and errors the response without leaking its message', async () => {
    const onError = vi.fn();
    async function* failing(): AsyncGenerator<string> {
      yield 'Merha';
      throw new Error('RAW-PROVIDER-BODY-SECRET');
    }
    const reader = toTextStream(failing(), onError).getReader();

    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('Merha');

    const error = await reader.read().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('SECRET');
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain('SECRET'); // the log hook sees it
  });

  it('stops the source when the response is cancelled', async () => {
    let cleanedUp = false;
    async function* source(): AsyncGenerator<string> {
      try {
        yield 'a';
        yield 'b';
        yield 'c';
      } finally {
        cleanedUp = true;
      }
    }
    const reader = toTextStream(source(), vi.fn()).getReader();
    await reader.read();
    await reader.cancel();
    expect(cleanedUp).toBe(true);
  });
});
