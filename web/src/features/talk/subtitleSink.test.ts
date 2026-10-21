import { describe, expect, it, vi } from 'vitest';

import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';

import { activeWordIndex, SubtitleSink, type SubtitleLine } from './subtitleSink';

const line = (overrides: Partial<SubtitleLine> = {}): SubtitleLine => ({
  id: 1,
  text: 'Merhaba nasılsın bugün',
  words: [],
  duration: 3,
  startedAt: 0,
  ...overrides,
});

describe('activeWordIndex', () => {
  it('follows TTS word timings when they match the words', () => {
    const timed = line({
      words: [
        { time: 0.1, duration: 0.5, text: 'Merhaba' },
        { time: 0.8, duration: 0.6, text: 'nasılsın' },
        { time: 1.6, duration: 0.5, text: 'bugün' },
      ],
    });
    const words = ['Merhaba', 'nasılsın', 'bugün'];
    expect(activeWordIndex(timed, words, 0)).toBe(-1);
    expect(activeWordIndex(timed, words, 0.9)).toBe(1);
    expect(activeWordIndex(timed, words, 2.5)).toBe(2);
  });

  it('spreads words over the clip by length without timings', () => {
    const words = ['Merhaba', 'nasılsın', 'bugün'];
    expect(activeWordIndex(line(), words, 0)).toBe(0);
    expect(activeWordIndex(line(), words, 1.5)).toBe(1);
    expect(activeWordIndex(line(), words, 3)).toBe(2);
  });
});

describe('SubtitleSink', () => {
  it('forwards to the player and reports the playing sentence', async () => {
    let ended: (() => void) | undefined;
    const player = {
      duration: 2,
      load: vi.fn(async () => undefined),
      play: vi.fn(async (onEnded?: () => void) => {
        ended = onEnded;
      }),
      stop: vi.fn(),
    } as unknown as SpeechPlayer;
    const lines: (SubtitleLine | null)[] = [];
    const sink = new SubtitleSink(player, (next) => lines.push(next));
    const audio = new ArrayBuffer(8);
    sink.register({ audio, visemes: [], words: [], text: 'Selam!' });

    await sink.load(audio, { text: 'Selam!' });
    await sink.play();
    expect(player.load).toHaveBeenCalledWith(audio, { text: 'Selam!' });
    expect(lines.at(-1)).toMatchObject({ text: 'Selam!', duration: 2 });

    ended?.();
    expect(lines.at(-1)).toBeNull();

    sink.stop();
    expect(player.stop).toHaveBeenCalled();
  });
});
