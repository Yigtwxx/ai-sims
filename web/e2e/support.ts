import type { Page } from '@playwright/test';

import en from '../messages/en.json';
import tr from '../messages/tr.json';

export { en, tr };

/** Fills ICU-style `{name}` placeholders, enough for the plain messages the tests read. */
export function format(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** 0.25 s of 16-bit mono silence at 16 kHz, as a base64 WAV file. */
export function silentWavBase64(seconds = 0.25, sampleRate = 16_000): string {
  const samples = Math.round(seconds * sampleRate);
  const data = samples * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + data, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(data, 40);
  return buffer.toString('base64');
}

export interface ChatCall {
  messages: { role: string; content: string }[];
  locale: string;
  characterId?: string;
}

/**
 * Replaces the AI and TTS routes with canned answers, so the flow never reaches
 * a provider (no keys, no cost, deterministic text). Returns the chat calls seen.
 */
export async function mockConversation(page: Page, reply: string): Promise<ChatCall[]> {
  const calls: ChatCall[] = [];
  await page.route('**/api/chat', async (route) => {
    calls.push(route.request().postDataJSON() as ChatCall);
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-AI-Provider': 'e2e' },
      body: reply,
    });
  });
  const audio = silentWavBase64();
  await page.route('**/api/tts', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ audio, mime: 'audio/wav', visemes: [], words: [] }),
    });
  });
  return calls;
}
