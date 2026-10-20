// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createSentenceSplitter, MAX_SENTENCE_CHARS } from './sentences';

/** Feeds the chunks one by one and collects everything, including the final flush. */
function split(chunks: string[]): string[] {
  const splitter = createSentenceSplitter();
  return [...chunks.flatMap((chunk) => splitter.push(chunk)), ...splitter.flush()];
}

describe('createSentenceSplitter', () => {
  it('splits sentences that arrive in one chunk', () => {
    expect(split(['Merhaba! Nasılsın? İyiyim, teşekkürler.'])).toEqual([
      'Merhaba!',
      'Nasılsın?',
      'İyiyim, teşekkürler.',
    ]);
  });

  it('gives the same result no matter how the text is chunked', () => {
    const text = 'Merhaba! Bugün hava çok güzel, değil mi? Evet. Dışarı çıkalım.';
    const whole = split([text]);
    expect(split([...text])).toEqual(whole);
    expect(split(text.match(/[\s\S]{1,7}/g) ?? [])).toEqual(whole);
  });

  it('holds back a terminator at the end of the buffer until more text or the flush', () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push('Merhaba!')).toEqual([]);
    expect(splitter.push(' Nasılsın?')).toEqual(['Merhaba!']);
    expect(splitter.flush()).toEqual(['Nasılsın?']);
  });

  it('keeps terminator runs together, even when they arrive in separate chunks', () => {
    expect(split(['Hmm... peki?! Tamam.'])).toEqual(['Hmm...', 'peki?!', 'Tamam.']);
    expect(split(['Hmm.', '..', ' peki?', '! Tamam.'])).toEqual(['Hmm...', 'peki?!', 'Tamam.']);
  });

  it('keeps a closing quote with its sentence', () => {
    expect(split(['Dedi ki "gel." Sonra gitti.'])).toEqual(['Dedi ki "gel."', 'Sonra gitti.']);
  });

  it('does not split inside a number or a word', () => {
    expect(split(['Pi yaklaşık 3.14 eder. Tamam.'])).toEqual(['Pi yaklaşık 3.14 eder.', 'Tamam.']);
  });

  it('treats a line break as a boundary', () => {
    expect(split(['Birinci satır\nİkinci satır'])).toEqual(['Birinci satır', 'İkinci satır']);
  });

  it('cuts an over-long run at a clause break, then at a space', () => {
    const clause = `${'a'.repeat(100)}, ${'b'.repeat(250)}`;
    expect(split([clause])).toEqual([`${'a'.repeat(100)},`, 'b'.repeat(250)]);

    const words = Array.from({ length: 120 }, () => 'kelime').join(' ');
    const pieces = split([words]);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
    expect(pieces.join(' ')).toBe(words);
  });

  it('returns nothing for empty or whitespace-only input and empties the buffer on flush', () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push('   \n ')).toEqual([]);
    expect(splitter.flush()).toEqual([]);
    splitter.push('Son söz');
    expect(splitter.flush()).toEqual(['Son söz']);
    expect(splitter.flush()).toEqual([]);
  });
});
