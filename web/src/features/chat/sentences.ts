/**
 * Incremental sentence splitter for streamed text. The reply arrives in small
 * chunks, but TTS works best one sentence at a time: the first sentence can be
 * spoken while the rest is still being written.
 */

/** A piece longer than this without a sentence end is cut at a natural break. */
export const MAX_SENTENCE_CHARS = 300;

export interface SentenceSplitter {
  /** Feeds the next chunk and returns the sentences that are now complete. */
  push(chunk: string): string[];
  /** Call when the stream ends; returns whatever text is left. */
  flush(): string[];
}

// Terminator run (. ! ? …) with optional closing quotes/brackets, then whitespace.
// A terminator at the very end of the buffer is not a boundary yet: "..." or "?!"
// may continue in the next chunk.
const BOUNDARY = /(?:[.!?…]+["'”’)\]]*\s+|\s*\n\s*)/;

function cutPoint(buffer: string): number {
  const match = BOUNDARY.exec(buffer);
  if (match) return match.index + match[0].length;
  if (buffer.length <= MAX_SENTENCE_CHARS) return -1;

  // Over-long run without a sentence end: prefer the last clause break, then any space.
  const head = buffer.slice(0, MAX_SENTENCE_CHARS);
  const clause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '));
  const space = head.lastIndexOf(' ');
  if (clause > 0) return clause + 1;
  return space > 0 ? space : MAX_SENTENCE_CHARS;
}

export function createSentenceSplitter(): SentenceSplitter {
  let buffer = '';

  const drain = (): string[] => {
    const sentences: string[] = [];
    for (let at = cutPoint(buffer); at > 0; at = cutPoint(buffer)) {
      const sentence = buffer.slice(0, at).trim();
      buffer = buffer.slice(at);
      if (sentence) sentences.push(sentence);
    }
    return sentences;
  };

  return {
    push(chunk) {
      buffer += chunk;
      return drain();
    },
    flush() {
      const rest = buffer.trim();
      buffer = '';
      return rest ? [rest] : [];
    },
  };
}
