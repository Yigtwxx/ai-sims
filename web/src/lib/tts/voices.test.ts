// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DEFAULT_TTS_VOICES } from '@/lib/env';
import { resolveVoice } from './voices';

describe('resolveVoice', () => {
  const env = { voices: DEFAULT_TTS_VOICES };

  it.each([
    ['tr', 'female', 'tr-TR-EmelNeural', 'tr-TR'],
    ['tr', 'male', 'tr-TR-AhmetNeural', 'tr-TR'],
    ['en', 'female', 'en-US-AvaNeural', 'en-US'],
    ['en', 'male', 'en-US-AndrewNeural', 'en-US'],
  ] as const)('picks the %s %s voice', (locale, gender, name, language) => {
    expect(resolveVoice(env, locale, gender)).toEqual({ name, language });
  });

  it('derives the language from an overridden voice name', () => {
    const custom = {
      voices: {
        ...DEFAULT_TTS_VOICES,
        en: { female: 'en-GB-SoniaNeural', male: 'en-GB-RyanNeural' },
      },
    };
    expect(resolveVoice(custom, 'en', 'female')).toEqual({
      name: 'en-GB-SoniaNeural',
      language: 'en-GB',
    });
  });

  it('falls back to the locale language for voice names without a locale prefix', () => {
    const custom = { voices: { ...DEFAULT_TTS_VOICES, tr: { female: 'Custom', male: 'Other' } } };
    expect(resolveVoice(custom, 'tr', 'female')).toEqual({ name: 'Custom', language: 'tr-TR' });
  });
});
