export type JsonBody =
  { ok: true; value: unknown } | { ok: false; reason: 'too_large' | 'invalid' };

/**
 * Reads a JSON request body without trusting its size. Bodies larger than
 * `maxBytes` are rejected as soon as the limit is crossed (or from
 * Content-Length when present), so a big upload is never fully buffered.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' };
  if (!request.body) return { ok: false, reason: 'invalid' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let received = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: 'too_large' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    // Malformed UTF-8, malformed JSON or a body stream that broke.
    return { ok: false, reason: 'invalid' };
  }
}
