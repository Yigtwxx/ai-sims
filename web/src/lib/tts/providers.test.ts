// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TtsError } from './errors';
import { synthesizeWithFallback, type SpeechProvider } from './providers';

const REQUEST = { text: 'Merhaba.', locale: 'tr' as const, gender: 'female' as const };
const SPEECH = { audio: new Uint8Array([1]), mime: 'audio/mpeg', visemes: [], words: [] };

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('synthesizeWithFallback', () => {
  it('returns the first provider that succeeds and names it', async () => {
    const azure: SpeechProvider = vi.fn().mockRejectedValue(new TtsError('rate_limit'));
    const edge: SpeechProvider = vi.fn().mockResolvedValue(SPEECH);
    const result = await synthesizeWithFallback(['azure', 'edge'], { azure, edge }, REQUEST);
    expect(result.provider).toBe('edge');
    expect(azure).toHaveBeenCalledOnce();
  });

  it('skips providers in the order that are not configured', async () => {
    const gemini: SpeechProvider = vi.fn().mockResolvedValue(SPEECH);
    const result = await synthesizeWithFallback(['azure', 'edge', 'gemini'], { gemini }, REQUEST);
    expect(result.provider).toBe('gemini');
  });

  it('throws the last failure when every provider fails', async () => {
    const azure: SpeechProvider = vi.fn().mockRejectedValue(new TtsError('auth'));
    const edge: SpeechProvider = vi.fn().mockRejectedValue(new TtsError('network'));
    await expect(
      synthesizeWithFallback(['azure', 'edge'], { azure, edge }, REQUEST),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('stops at an aborted request instead of trying the next provider', async () => {
    const controller = new AbortController();
    const azure: SpeechProvider = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new TtsError('network');
    });
    const edge: SpeechProvider = vi.fn().mockResolvedValue(SPEECH);
    await expect(
      synthesizeWithFallback(
        ['azure', 'edge'],
        { azure, edge },
        { ...REQUEST, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(edge).not.toHaveBeenCalled();
  });
});
