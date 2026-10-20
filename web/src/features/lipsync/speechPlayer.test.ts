import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpeechPlayer } from './speechPlayer';

// A 2 second clip of constant loudness: one speech region, full mouth opening.
const DURATION = 2;
const SAMPLE_RATE = 100;

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  outputLatency = 0;
  destination = {};

  decodeAudioData = async () => ({
    duration: DURATION,
    sampleRate: SAMPLE_RATE,
    getChannelData: () => new Float32Array(DURATION * SAMPLE_RATE).fill(0.5),
  });

  createBufferSource() {
    return { buffer: null, onended: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }

  getOutputTimestamp() {
    return { contextTime: this.currentTime };
  }

  resume = async () => undefined;
  close = async () => undefined;
}

let context: FakeAudioContext;

beforeEach(() => {
  context = new FakeAudioContext();
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Loads a script, starts playback and returns the mouth shape heard at `seconds`. */
async function mouthAt(script: Parameters<SpeechPlayer['load']>[1], seconds: number) {
  const player = new SpeechPlayer();
  await player.load(new ArrayBuffer(8), script);
  await player.play();
  context.currentTime = seconds;
  return player.sample();
}

describe('SpeechPlayer.load', () => {
  it('uses viseme events when given', async () => {
    const weights = await mouthAt({ events: [{ viseme: 'PP', time: 0.5 }] }, 1);
    expect(weights.PP).toBeCloseTo(1);
  });

  it('uses word boundaries when given', async () => {
    // "ma" stretched over [0.5, 1.5]: the mouth closes for the "m" first.
    const weights = await mouthAt({ words: [{ text: 'ma', time: 0.5, duration: 1 }] }, 0.6);
    expect(weights.PP).toBeGreaterThan(0.5);
  });

  it('falls back to aligning the text to the audio', async () => {
    const weights = await mouthAt({ text: 'a' }, 1);
    expect(weights.aa).toBeGreaterThan(0.5);
  });

  it('prefers events over words over text when several are given', async () => {
    const everything = {
      events: [{ viseme: 'U' as const, time: 0 }],
      words: [{ text: 'a', time: 0, duration: 2 }],
      text: 'a',
    };
    const withEvents = await mouthAt(everything, 1);
    expect(withEvents.U).toBeCloseTo(1);
    expect(withEvents.aa).toBeUndefined();

    const withWords = await mouthAt({ words: everything.words, text: 'u' }, 1);
    expect(withWords.aa).toBeGreaterThan(0.5);
    expect(withWords.U).toBeUndefined();
  });

  it('stays silent outside the spoken part of the clip', async () => {
    const weights = await mouthAt({ words: [{ text: 'ma', time: 0.5, duration: 0.5 }] }, 1.8);
    expect(weights).toEqual({});
  });
});
