// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROVIDER_IDS } from './ai/types';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_PROVIDER_ORDER,
  DEFAULT_TTS_VOICES,
  DEFAULT_USAGE_LIMITS,
  getAiEnv,
  getAzureSpeechEnv,
  getUsageEnv,
  isAzureSpeechConfigured,
  parseProviderOrder,
} from './env';

const MANAGED_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'AI_PROVIDER_ORDER',
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_REGION',
  'AZURE_TTS_VOICE_TR_FEMALE',
  'AZURE_TTS_VOICE_TR_MALE',
  'AZURE_TTS_VOICE_EN_FEMALE',
  'AZURE_TTS_VOICE_EN_MALE',
  'CHAT_DAILY_LIMIT_PER_USER',
  'CHAT_DAILY_LIMIT_TOTAL',
  'TTS_DAILY_CHARS_PER_USER',
  'TTS_DAILY_CHARS_TOTAL',
  'ANTHROPIC_DAILY_LIMIT',
];

beforeEach(() => {
  for (const name of MANAGED_VARS) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseProviderOrder', () => {
  it('defaults to groq, gemini, anthropic: free providers first, the paid one last', () => {
    expect(parseProviderOrder(undefined).order).toEqual(['groq', 'gemini', 'anthropic']);
    expect(parseProviderOrder('').order).toEqual(['groq', 'gemini', 'anthropic']);
  });

  it('lists every known provider exactly once in the default order', () => {
    // The default is written out, not derived from PROVIDER_IDS, so a new provider id must be
    // added to it by hand; this fails until it is.
    expect([...DEFAULT_PROVIDER_ORDER].sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it('keeps the configured order, lowercases and removes duplicates', () => {
    expect(parseProviderOrder(' Groq , gemini,groq ').order).toEqual(['groq', 'gemini']);
  });

  it('reports unknown names and falls back to the default when nothing valid is left', () => {
    const parsed = parseProviderOrder('openai, mistral');
    expect(parsed.ignored).toEqual(['openai', 'mistral']);
    expect(parsed.order).toEqual(['groq', 'gemini', 'anthropic']);
  });
});

describe('getAiEnv', () => {
  it('treats unset and blank variables as not configured and uses default models', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '   ');
    const env = getAiEnv();
    expect(env.anthropicApiKey).toBeUndefined();
    expect(env.geminiApiKey).toBeUndefined();
    expect(env.groqApiKey).toBeUndefined();
    expect(env.anthropicModel).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(env.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(env.groqModel).toBe(DEFAULT_GROQ_MODEL);
    expect(env.providerOrder).toEqual(['groq', 'gemini', 'anthropic']);
  });

  it('uses claude-haiku-5-5 without a date suffix by default', () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-haiku-5-5');
  });

  it('pins the free-tier models instead of following a -latest alias', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(DEFAULT_GEMINI_MODEL).not.toMatch(/latest/);
    expect(DEFAULT_GROQ_MODEL).toBe('openai/gpt-oss-120b');
  });

  it('reads keys and model overrides', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', ' sk-test ');
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5');
    vi.stubEnv('GROQ_MODEL', 'llama-3.3-70b-versatile');
    vi.stubEnv('AI_PROVIDER_ORDER', 'groq,anthropic');
    const env = getAiEnv();
    expect(env.anthropicApiKey).toBe('sk-test');
    expect(env.anthropicModel).toBe('claude-sonnet-5-5');
    expect(env.groqModel).toBe('llama-3.3-70b-versatile');
    expect(env.providerOrder).toEqual(['groq', 'anthropic']);
  });

  it('ignores keys with embedded whitespace and malformed model ids', () => {
    vi.stubEnv('GROQ_API_KEY', 'two words');
    vi.stubEnv('GEMINI_MODEL', 'gemini 3?x=1');
    const env = getAiEnv();
    expect(env.groqApiKey).toBeUndefined();
    expect(env.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('warns once per unknown provider name without printing any key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-secret-value');
    vi.stubEnv('AI_PROVIDER_ORDER', 'anthropic,deepseek-test');
    getAiEnv();
    getAiEnv();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('deepseek-test');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('sk-secret-value');
  });
});

describe('getAzureSpeechEnv', () => {
  it('is null until both key and region are set', () => {
    expect(getAzureSpeechEnv()).toBeNull();
    vi.stubEnv('AZURE_SPEECH_KEY', 'key');
    expect(getAzureSpeechEnv()).toBeNull();
    expect(isAzureSpeechConfigured()).toBe(false);
    vi.stubEnv('AZURE_SPEECH_REGION', 'westeurope');
    expect(isAzureSpeechConfigured()).toBe(true);
  });

  it('rejects malformed regions', () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'key');
    vi.stubEnv('AZURE_SPEECH_REGION', 'west europe/../x');
    expect(getAzureSpeechEnv()).toBeNull();
  });

  it('lowercases the region and exposes the verified default voices', () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'key');
    vi.stubEnv('AZURE_SPEECH_REGION', 'WestEurope');
    const env = getAzureSpeechEnv();
    expect(env?.region).toBe('westeurope');
    expect(env?.voices).toEqual(DEFAULT_TTS_VOICES);
    expect(env?.voices.tr).toEqual({ female: 'tr-TR-EmelNeural', male: 'tr-TR-AhmetNeural' });
  });

  it('accepts voice overrides and ignores malformed ones', () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'key');
    vi.stubEnv('AZURE_SPEECH_REGION', 'eastus');
    vi.stubEnv('AZURE_TTS_VOICE_EN_FEMALE', 'en-GB-SoniaNeural');
    vi.stubEnv('AZURE_TTS_VOICE_EN_MALE', "x'><voice name='evil");
    const voices = getAzureSpeechEnv()?.voices;
    expect(voices?.en.female).toBe('en-GB-SoniaNeural');
    expect(voices?.en.male).toBe(DEFAULT_TTS_VOICES.en.male);
  });
});

describe('getUsageEnv', () => {
  it('uses the defaults when nothing is set', () => {
    expect(getUsageEnv()).toEqual(DEFAULT_USAGE_LIMITS);
  });

  it('reads positive integer overrides', () => {
    vi.stubEnv('CHAT_DAILY_LIMIT_PER_USER', ' 20 ');
    vi.stubEnv('ANTHROPIC_DAILY_LIMIT', '5');
    expect(getUsageEnv()).toMatchObject({ chatPerUser: 20, anthropicTotal: 5 });
  });

  it.each(['0', '-3', '1.5', 'many', ''])('keeps the default for %j', (value) => {
    vi.stubEnv('TTS_DAILY_CHARS_TOTAL', value);
    expect(getUsageEnv().ttsCharsTotal).toBe(DEFAULT_USAGE_LIMITS.ttsCharsTotal);
  });
});
