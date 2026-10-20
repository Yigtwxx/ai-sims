/**
 * Turns an async stream of text into a byte stream for a `Response` body.
 *
 * - A failure mid-stream is reported through `onError` (log it there, without
 *   provider details) and then errors the response, so the browser sees an
 *   interrupted reply instead of a silently truncated one.
 * - Cancelling the response (client disconnect) stops the source, which in
 *   turn cancels the upstream provider request.
 */
export function toTextStream(
  source: AsyncIterable<string>,
  onError: (error: unknown) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = source[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (error) {
        onError(error);
        controller.error(new Error('The reply was interrupted'));
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
