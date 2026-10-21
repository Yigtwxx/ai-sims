import 'server-only';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type { Readable } from 'node:stream';
import { TtsError, type TtsFailureKind } from './errors';
import { withRetry } from './retry';
import type { TtsWord } from './types';

/**
 * Microsoft Edge "Read aloud" voices through msedge-tts (MIT). These are the same
 * neural voices Azure offers (tr-TR-EmelNeural, tr-TR-AhmetNeural, ...) but through
 * an unofficial endpoint without a key or a usage agreement, so it is a demo-only
 * fallback behind TTS_ENABLE_EDGE. It reports word boundaries, not visemes; the
 * client derives visemes from the words with the Turkish rule engine.
 */

const TICKS_PER_SECOND = 10_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_DELAYS_MS = [300, 900] as const;
const RETRYABLE_KINDS: ReadonlySet<TtsFailureKind> = new Set(['network', 'service']);

export const EDGE_SPEECH_MIME = 'audio/mpeg';

export interface EdgeSynthesizeParams {
  text: string;
  /** Voice short name, e.g. `tr-TR-EmelNeural`. */
  voice: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Pauses before each retry (tests pass short ones). */
  retryDelaysMs?: readonly number[];
}

export interface EdgeSpeech {
  audio: Uint8Array;
  mime: typeof EDGE_SPEECH_MIME;
  words: TtsWord[];
}

interface BoundaryRecord {
  Type?: string;
  Data?: { Offset?: number; Duration?: number; text?: { Text?: string } };
}

/** Word boundaries from the raw `audio.metadata` JSON chunks (times in seconds). */
export function parseWordBoundaries(chunks: readonly string[]): TtsWord[] {
  const words: TtsWord[] = [];
  for (const chunk of chunks) {
    let parsed: { Metadata?: BoundaryRecord[] };
    try {
      parsed = JSON.parse(chunk) as { Metadata?: BoundaryRecord[] };
    } catch {
      continue;
    }
    for (const record of parsed.Metadata ?? []) {
      const text = record.Data?.text?.Text?.trim();
      if (record.Type !== 'WordBoundary' || !text) continue;
      words.push({
        time: (record.Data?.Offset ?? 0) / TICKS_PER_SECOND,
        duration: (record.Data?.Duration ?? 0) / TICKS_PER_SECOND,
        text,
      });
    }
  }
  return words.sort((a, b) => a.time - b.time);
}

function collect(stream: Readable): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    stream.on('data', (part: Buffer | string) => {
      parts.push(typeof part === 'string' ? Buffer.from(part) : part);
    });
    stream.once('end', () => resolve(parts));
    stream.once('close', () => resolve(parts));
    stream.once('error', reject);
  });
}

/** Escapes text for the SSML body msedge-tts wraps it in. */
function escapeSsml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Synthesizes `text`, retrying quick transient failures (dropped connections,
 * empty audio) with backoff, so a hiccup does not fall through to a provider
 * without word timings. Timeouts and aborts fail immediately.
 */
export function synthesizeWithEdge(params: EdgeSynthesizeParams): Promise<EdgeSpeech> {
  return withRetry(() => synthesizeOnce(params), {
    delaysMs: params.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    shouldRetry: (error) => error instanceof TtsError && RETRYABLE_KINDS.has(error.kind),
    signal: params.signal,
  });
}

async function synthesizeOnce(params: EdgeSynthesizeParams): Promise<EdgeSpeech> {
  if (params.signal?.aborted) throw new TtsError('aborted');
  const tts = new MsEdgeTTS({ synthesisTimeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  const abort = () => tts.close();
  params.signal?.addEventListener('abort', abort, { once: true });
  try {
    await tts.setMetadata(params.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
    });
    const { audioStream, metadataStream } = tts.toStream(escapeSsml(params.text));
    const [audioParts, metadataParts] = await Promise.all([
      collect(audioStream),
      metadataStream ? collect(metadataStream) : Promise.resolve([]),
    ]);
    if (params.signal?.aborted) throw new TtsError('aborted');
    const audio = Buffer.concat(audioParts);
    if (audio.byteLength === 0) throw new TtsError('service');
    return {
      audio: new Uint8Array(audio),
      mime: EDGE_SPEECH_MIME,
      words: parseWordBoundaries(metadataParts.map((part) => part.toString('utf8'))),
    };
  } catch (error) {
    if (error instanceof TtsError) throw error;
    if (params.signal?.aborted) throw new TtsError('aborted');
    // msedge-tts reports its connection and synthesis timeouts only in the message.
    throw new TtsError(
      error instanceof Error && /timed out/i.test(error.message) ? 'timeout' : 'network',
    );
  } finally {
    params.signal?.removeEventListener('abort', abort);
    tts.close();
  }
}
