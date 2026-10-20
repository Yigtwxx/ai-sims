// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { cleanSpeechText } from './speechText';

describe('cleanSpeechText', () => {
  it('leaves plain Turkish and English sentences untouched', () => {
    expect(cleanSpeechText('Merhaba, bugün hava çok güzel! İyi misin?')).toBe(
      'Merhaba, bugün hava çok güzel! İyi misin?',
    );
    expect(cleanSpeechText("It's a nice day, isn't it?")).toBe("It's a nice day, isn't it?");
  });

  it('removes emojis, including skin tones, ZWJ sequences and variation selectors', () => {
    expect(cleanSpeechText('Harika 😊 haber 👍🏽 bu ❤️ gerçek 👩‍💻!')).toBe('Harika haber bu gerçek !');
  });

  it('strips markdown emphasis, code and strikethrough but keeps the words', () => {
    expect(cleanSpeechText('Bu **çok önemli** ve *kısa* bir `komut` ~~değil~~')).toBe(
      'Bu çok önemli ve kısa bir komut değil',
    );
  });

  it('strips emphasis underscores without touching snake_case words', () => {
    expect(cleanSpeechText('Bu _vurgulu_ ve __kalın__ ama snake_case kalır.')).toBe(
      'Bu vurgulu ve kalın ama snake_case kalır.',
    );
  });

  it('removes heading, quote and list markers at the start of a line', () => {
    expect(cleanSpeechText('# Başlık\n> alıntı\n- bir\n* iki\n3. üç\n4) dört')).toBe(
      'Başlık alıntı bir iki üç dört',
    );
  });

  it('keeps only the label of a markdown link and drops bare URLs', () => {
    expect(
      cleanSpeechText('Bak [buraya](https://example.com/a?b=1) ve https://x.org/y ya da www.z.com'),
    ).toBe('Bak buraya ve ya da');
  });

  it('collapses whitespace and trims', () => {
    expect(cleanSpeechText('  a \n\n  b\t c  ')).toBe('a b c');
  });

  it('returns an empty string when nothing speakable is left', () => {
    expect(cleanSpeechText('😊😊')).toBe('');
    expect(cleanSpeechText('   ')).toBe('');
    expect(cleanSpeechText('')).toBe('');
  });
});
