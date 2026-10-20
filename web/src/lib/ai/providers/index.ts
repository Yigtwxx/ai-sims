import { getAiEnv } from '@/lib/env';
import { PROVIDER_IDS, type ChatProvider, type ProviderId } from '../types';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { groqProvider } from './groq';

const PROVIDERS: Record<ProviderId, ChatProvider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  groq: groqProvider,
};

/** Providers in AI_PROVIDER_ORDER (default: groq, gemini, anthropic), configured or not. */
export function getOrderedProviders(): ChatProvider[] {
  return getAiEnv().providerOrder.map((id) => PROVIDERS[id]);
}

/** True when at least one provider in the order has credentials. */
export function hasConfiguredProvider(): boolean {
  return getOrderedProviders().some((provider) => provider.isConfigured());
}

/** Whether each provider has credentials, regardless of AI_PROVIDER_ORDER. Never exposes values. */
export function getProviderConfiguration(): Record<ProviderId, boolean> {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDERS[id].isConfigured()])) as Record<
    ProviderId,
    boolean
  >;
}
