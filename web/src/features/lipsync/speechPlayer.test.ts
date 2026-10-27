import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpeechPlayer } from './speechPlayer';

// A 2 second clip of constant loudness: one speech region, full mouth opening.
const DURATION = 2;
// One sample per envelope frame.
const SAMPLE_RATE = 100;

/** What the fake decoder returns; a test may replace it before loading. */
let pcm: Float32Array;

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  outputLatency = 0;
  destination = {};

  decodeAudioData = async () => ({
    duration: pcm.length / SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
    getChannelData: () => pcm,
  });

  sampleRate = 48000;
  sources: { start: ReturnType<typeof vi.fn> }[] = [];

  createBufferSource() {
    const source = { buffer: null, onended: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.sources.push(source);
    return source;
  }

  createBuffer = vi.fn(() => ({}));

  getOutputTimestamp() {
    return { contextTime: this.currentTime };
  }

  resume = vi.fn(async () => undefined);
  close = async () => undefined;
}

let context: FakeAudioContext;

beforeEach(() => {
  pcm = new Float32Array(DURATION * SAMPLE_RATE).fill(0.5);
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
  // No visual lead: these tests pin timing sources, not the lead (tested below).
  const player = new SpeechPlayer(0);
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

  it('moves viseme events onto the decoded audio when it starts late', async () => {
    // "ama" three times; the MP3's decoder delay puts the audio 60 ms behind the events.
    const events: { viseme: 'aa' | 'PP' | 'sil'; time: number }[] = [];
    for (let k = 0; k < 3; k++) {
      const t = 0.1 + k * 0.5;
      events.push({ viseme: 'aa', time: t }, { viseme: 'PP', time: t + 0.15 });
      events.push({ viseme: 'aa', time: t + 0.21 }, { viseme: 'sil', time: t + 0.35 });
    }
    const loud = (t: number) => {
      const at = events.findLast((e) => e.time <= t);
      return at?.viseme === 'aa' ? 0.5 : 0.01;
    };
    pcm = Float32Array.from({ length: DURATION * SAMPLE_RATE }, (_, f) =>
      loud((f + 0.5) / SAMPLE_RATE - 0.06),
    );
    // The first closure is heard over [0.31, 0.37], not [0.25, 0.31] as reported.
    expect((await mouthAt({ events }, 0.34)).PP).toBeGreaterThan(0.5);
    expect((await mouthAt({ events }, 0.27)).PP ?? 0).toBeLessThan(0.5);
  });

  it('stays silent outside the spoken part of the clip', async () => {
    const weights = await mouthAt({ words: [{ text: 'ma', time: 0.5, duration: 0.5 }] }, 1.8);
    expect(weights).toEqual({});
  });
});

describe('SpeechPlayer visual lead', () => {
  it('shows the mouth shape that is about to be heard', async () => {
    const player = new SpeechPlayer(0.1);
    await player.load(new ArrayBuffer(8), {
      events: [
        { viseme: 'aa', time: 0 },
        { viseme: 'PP', time: 0.5 },
      ],
    });
    await player.play();
    context.currentTime = 0.45;
    // Heard: still "aa"; shown: the closure 0.1 s ahead.
    expect(player.sample().PP).toBeGreaterThan(0.5);
  });
});

describe('SpeechPlayer.unlock', () => {
  it('wakes a suspended context and starts silence before any await', () => {
    // Safari only lets a context run if it is resumed inside the user's gesture,
    // and speech arrives seconds after the click that asked for it.
    context.state = 'suspended';
    const player = new SpeechPlayer(0);
    player.unlock();
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledTimes(1);
  });

  it('does not resume a context that already runs', () => {
    const player = new SpeechPlayer(0);
    player.unlock();
    expect(context.resume).not.toHaveBeenCalled();
  });
});
