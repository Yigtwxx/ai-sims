// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { readJsonBody } from './body';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/test', { method: 'POST', body, headers });

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    expect(await readJsonBody(post('{"a":1,"b":"Türkçe ğüşiöç"}'), 1024)).toEqual({
      ok: true,
      value: { a: 1, b: 'Türkçe ğüşiöç' },
    });
  });

  it('rejects an empty body, malformed JSON and invalid UTF-8 as invalid', async () => {
    expect(await readJsonBody(post(null), 1024)).toEqual({ ok: false, reason: 'invalid' });
    expect(await readJsonBody(post('{nope'), 1024)).toEqual({ ok: false, reason: 'invalid' });
    expect(await readJsonBody(post(new Uint8Array([0x7b, 0xff, 0x7d])), 1024)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects by Content-Length before reading anything', async () => {
    const request = post('{}', { 'content-length': '5000' });
    expect(await readJsonBody(request, 1024)).toEqual({ ok: false, reason: 'too_large' });
    expect(request.bodyUsed).toBe(false);
  });

  it('stops reading once the limit is crossed, even without a Content-Length', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode('x'.repeat(400)));
        if (pulled > 50) controller.close();
      },
    });
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);

    expect(await readJsonBody(request, 1000)).toEqual({ ok: false, reason: 'too_large' });
    expect(pulled).toBeLessThan(10);
  });

  it('accepts a body exactly at the limit', async () => {
    const body = JSON.stringify({ s: 'a'.repeat(20) });
    expect(await readJsonBody(post(body), new TextEncoder().encode(body).byteLength)).toEqual({
      ok: true,
      value: { s: 'a'.repeat(20) },
    });
  });

  it('reassembles multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"s":"ğ"}');
    const split = bytes.indexOf(0xc4) + 1; // between the two bytes of "ğ"
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);

    expect(await readJsonBody(request, 1024)).toEqual({ ok: true, value: { s: 'ğ' } });
  });
});
