/**
 * Safety net before text reaches a TTS engine. The persona prompt already
 * asks the model for plain spoken sentences, but models still slip: emojis get
 * read out by name and markdown symbols get spoken or cause odd pauses.
 *
 * Pure and free of server-only imports, so the browser pipeline and the TTS
 * route share it.
 */
export function cleanSpeechText(text: string): string {
  return (
    text
      // [label](https://example.com) keeps only the label.
      .replace(/\[([^\]\n]+)\]\((?:[^)\s]+)\)/g, '$1')
      .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
      // Pictographs plus the pieces that build sequences: skin tones, flags, keycaps, ZWJ, VS16.
      .replace(
        /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u20E3\uFE0F\u200D]/gu,
        ' ',
      )
      // Block-level markdown at the start of a line: headings, quotes, bullets, numbering.
      .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-+•*][ \t]+|\d+[.)][ \t]+)/gm, '')
      // Inline emphasis and code.
      .replace(/[*~`]+/g, '')
      .replace(/(^|[\s(])_+|_+(?=[\s).,!?;:]|$)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
