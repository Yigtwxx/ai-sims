// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_TTS_VOICES,
  getAiEnv,
  getAzureSpeechEnv,
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
];

beforeEach(() => {
  for (const name of MANAGED_VARS) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseProviderOrder', () => {
  it('defaults to anthropic, gemini, groq', () => {
    expect(parseProviderOrder(undefined).order).toEqual(['anthropic', 'gemini', 'groq']);
    expect(parseProviderOrder('').order).toEqual(['anthropic', 'gemini', 'groq']);
  });

  it('keeps the configured order, lowercases and removes duplicates', () => {
    expect(parseProviderOrder(' Groq , gemini,groq ').order).toEqual(['groq', 'gemini']);
  });

  it('reports unknown names and falls back to the default when nothing valid is left', () => {
    const parsed = parseProviderOrder('openai, mistral');
    expect(parsed.ignored).toEqual(['openai', 'mistral']);
    expect(parsed.order).toEqual(['anthropic', 'gemini', 'groq']);
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
    expect(env.providerOrder).toEqual(['anthropic', 'gemini', 'groq']);
  });

  it('uses claude-opus-5-5 without a date suffix by default', () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-opus-5-5');
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
