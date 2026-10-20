import 'server-only';
import { z } from 'zod';
import { PROVIDER_IDS, isProviderId, type ProviderId } from '@/lib/ai/types';
import type { TtsVoices } from '@/lib/tts/types';

const MongoEnvSchema = z.object({
  uri: z.string().regex(/^mongodb(\+srv)?:\/\/.+/, 'Expected a mongodb:// or mongodb+srv:// URI'),
});

const AuthEnvSchema = z.object({
  secret: z.string().min(32),
  url: z.url(),
});

export type MongoEnv = z.infer<typeof MongoEnvSchema>;
export type AuthEnv = z.infer<typeof AuthEnvSchema>;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('Database is not configured: set MONGODB_URI, BETTER_AUTH_SECRET and BETTER_AUTH_URL');
    this.name = 'DatabaseNotConfiguredError';
  }
}

/**
 * Env readers never throw and never run at import time, so the app can build and
 * render public pages without a .env file. Values are read on each call so tests
 * can change them.
 */
export function getMongoEnv(): MongoEnv | null {
  const parsed = MongoEnvSchema.safeParse({ uri: process.env.MONGODB_URI });
  return parsed.success ? parsed.data : null;
}

export function getAuthEnv(): AuthEnv | null {
  const parsed = AuthEnvSchema.safeParse({
    secret: process.env.BETTER_AUTH_SECRET,
    url: process.env.BETTER_AUTH_URL,
  });
  return parsed.success ? parsed.data : null;
}

/** True when both the database and the auth settings are present and valid. */
export function isDatabaseConfigured(): boolean {
  return getMongoEnv() !== null && getAuthEnv() !== null;
}

export function requireMongoEnv(): MongoEnv {
  const env = getMongoEnv();
  if (!env) throw new DatabaseNotConfiguredError();
  return env;
}

export function requireAuthEnv(): AuthEnv {
  const env = getAuthEnv();
  if (!env) throw new DatabaseNotConfiguredError();
  return env;
}

/* ------------------------------------------------------------------------- *
 * AI providers and text-to-speech. Every variable here is optional: without
 * keys the app still runs and the API routes answer "not configured".
 * ------------------------------------------------------------------------- */

/**
 * Defaults, chosen on 2026-10-20 by timing one Turkish persona turn on this project's own keys
 * (time to first token over several runs per candidate) and checking the providers' docs.
 * Groq and Gemini are used on their free tiers, so the picks are fast, reliable and light on
 * quota rather than the biggest model each provider has:
 * - Groq: `openai/gpt-oss-120b` with low, hidden reasoning. About 0.3 s to the first token,
 *   correct facts, natural Turkish. `gpt-oss-20b` got a fact wrong and `qwen/qwen3.8-27b` made
 *   typos. All three share the same free base limits (docs and response headers).
 *   https://console.groq.com/docs/models
 *   https://console.groq.com/docs/reasoning
 *   https://console.groq.com/docs/rate-limits
 * - Gemini: pinned `gemini-3.5-flash-lite` with `MINIMAL` thinking. No errors in 40+ calls and
 *   about 0.6 s to the first token when warm (a call after minutes of idle took 0.6 to 11 s).
 *   The bigger Flash models were slow, overloaded or out of free quota (`gemini-3.8-flash`:
 *   timeouts and 429). The models page says "For any new projects, use our latest models:
 *   3.5 Flash-Lite or 3.8 Flash"; pricing lists a free tier for 3.5 Flash-Lite.
 *   https://ai.google.dev/gemini-api/docs/models
 *   https://ai.google.dev/gemini-api/docs/pricing
 * - Claude: `claude-haiku-5-5`, exactly this id (no date suffix). Cheap ($0.10 / $0.50 per
 *   million tokens up to a 100K-token prompt), about 1 s to the first token, natural Turkish.
 *   It is the paid last resort, used only when both free providers fail before their first token.
 *   https://platform.claude.com/docs/en/about-claude/models/overview
 *   https://platform.claude.com/docs/en/about-claude/pricing
 * - Order: free providers first, the paid one last. Written out on purpose instead of
 *   deriving it from PROVIDER_IDS, whose order is only the registry order.
 * - Azure voices: Standard neural voices from the voice table. tr-TR is also listed in the
 *   "Visemes" table of the same page (Viseme ID, no blend shapes).
 *   https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_PROVIDER_ORDER: readonly ProviderId[] = ['groq', 'gemini', 'anthropic'];

export const DEFAULT_TTS_VOICES: TtsVoices = {
  tr: { female: 'tr-TR-EmelNeural', male: 'tr-TR-AhmetNeural' },
  en: { female: 'en-US-AvaNeural', male: 'en-US-AndrewNeural' },
};

export interface AiEnv {
  /** Providers to try, in order. Providers without a key are skipped at call time. */
  providerOrder: readonly ProviderId[];
  anthropicApiKey: string | undefined;
  anthropicModel: string;
  geminiApiKey: string | undefined;
  geminiModel: string;
  groqApiKey: string | undefined;
  groqModel: string;
}

export interface AzureSpeechEnv {
  key: string;
  region: string;
  voices: TtsVoices;
}

/** Trimmed value, or undefined when the variable is unset or blank (`KEY=` placeholders). */
function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** API keys never contain whitespace; a value that does is treated as not set. */
function readSecret(name: string): string | undefined {
  const value = readEnv(name);
  return value && /^\S+$/.test(value) ? value : undefined;
}

const ModelIdSchema = z.string().regex(/^[\w./:-]{1,120}$/);
const VoiceNameSchema = z.string().regex(/^[\p{L}\p{N}._:-]{1,100}$/u);
const RegionSchema = z.string().regex(/^[a-z0-9-]{2,40}$/);

function readModel(name: string, fallback: string): string {
  const parsed = ModelIdSchema.safeParse(readEnv(name));
  return parsed.success ? parsed.data : fallback;
}

function readVoice(name: string, fallback: string): string {
  const parsed = VoiceNameSchema.safeParse(readEnv(name));
  return parsed.success ? parsed.data : fallback;
}

/**
 * Parses AI_PROVIDER_ORDER ("groq,gemini,anthropic"). Unknown names are reported
 * in `ignored`; when nothing valid remains the default order is used.
 */
export function parseProviderOrder(raw: string | undefined): {
  order: ProviderId[];
  ignored: string[];
} {
  const order = new Set<ProviderId>();
  const ignored: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (isProviderId(id)) order.add(id);
    else ignored.push(id);
  }
  return { order: order.size > 0 ? [...order] : [...DEFAULT_PROVIDER_ORDER], ignored };
}

const warnedProviderNames = new Set<string>();

/** Never throws and never logs values of secrets; values are read on each call. */
export function getAiEnv(): AiEnv {
  const { order, ignored } = parseProviderOrder(process.env.AI_PROVIDER_ORDER);
  for (const name of ignored) {
    if (warnedProviderNames.has(name)) continue;
    warnedProviderNames.add(name);
    console.warn(
      `[env] AI_PROVIDER_ORDER: ignoring unknown provider "${name}" (expected ${PROVIDER_IDS.join(', ')})`,
    );
  }
  return {
    providerOrder: order,
    anthropicApiKey: readSecret('ANTHROPIC_API_KEY'),
    anthropicModel: readModel('ANTHROPIC_MODEL', DEFAULT_ANTHROPIC_MODEL),
    geminiApiKey: readSecret('GEMINI_API_KEY'),
    geminiModel: readModel('GEMINI_MODEL', DEFAULT_GEMINI_MODEL),
    groqApiKey: readSecret('GROQ_API_KEY'),
    groqModel: readModel('GROQ_MODEL', DEFAULT_GROQ_MODEL),
  };
}

/** Null unless both the key and a valid region are set. */
export function getAzureSpeechEnv(): AzureSpeechEnv | null {
  const key = readSecret('AZURE_SPEECH_KEY');
  const region = RegionSchema.safeParse(readEnv('AZURE_SPEECH_REGION')?.toLowerCase());
  if (!key || !region.success) return null;

  return {
    key,
    region: region.data,
    voices: {
      tr: {
        female: readVoice('AZURE_TTS_VOICE_TR_FEMALE', DEFAULT_TTS_VOICES.tr.female),
        male: readVoice('AZURE_TTS_VOICE_TR_MALE', DEFAULT_TTS_VOICES.tr.male),
      },
      en: {
        female: readVoice('AZURE_TTS_VOICE_EN_FEMALE', DEFAULT_TTS_VOICES.en.female),
        male: readVoice('AZURE_TTS_VOICE_EN_MALE', DEFAULT_TTS_VOICES.en.male),
      },
    },
  };
}

export function isAzureSpeechConfigured(): boolean {
  return getAzureSpeechEnv() !== null;
}
