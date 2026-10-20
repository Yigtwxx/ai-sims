import type { Viseme } from './visemes';

/**
 * Azure Speech viseme ids (0-21) mapped to the Oculus visemes our renderers
 * understand. The id table (which mouth shape each id stands for) is in
 * https://learn.microsoft.com/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
 * Index = Microsoft viseme id.
 */
export const AZURE_TO_OCULUS: readonly Viseme[] = [
  'sil', // 0  silence
  'aa', // 1  æ ə ʌ
  'aa', // 2  ɑ
  'O', // 3  ɔ
  'E', // 4  ɛ ʊ
  'RR', // 5  ɝ
  'I', // 6  j i ɪ
  'U', // 7  w u
  'O', // 8  o
  'aa', // 9  aʊ
  'O', // 10 ɔɪ
  'aa', // 11 aɪ
  'kk', // 12 h
  'RR', // 13 ɹ
  'nn', // 14 l
  'SS', // 15 s z
  'CH', // 16 ʃ tʃ dʒ ʒ
  'TH', // 17 ð
  'FF', // 18 f v
  'DD', // 19 d t n θ
  'kk', // 20 k g ŋ
  'PP', // 21 p b m
];

/** Unknown or out-of-range ids become silence rather than a wrong mouth shape. */
export function azureVisemeToOculus(id: number): Viseme {
  return Number.isInteger(id) ? (AZURE_TO_OCULUS[id] ?? 'sil') : 'sil';
}

/** Viseme event as returned by `POST /api/tts`: `time` in seconds, `id` is the Azure id. */
export interface AzureVisemeEvent {
  time: number;
  id: number;
}

/** Timed Oculus viseme, the shape `SpeechPlayer.load({ events })` expects. */
export interface VisemeEvent {
  viseme: Viseme;
  time: number;
}

/**
 * Converts TTS viseme events into player events: drops events with an invalid
 * time, sorts by time (the service normally delivers them in order) and maps ids.
 */
export function toVisemeEvents(events: readonly AzureVisemeEvent[]): VisemeEvent[] {
  return events
    .filter((event) => Number.isFinite(event.time) && event.time >= 0)
    .sort((a, b) => a.time - b.time)
    .map((event) => ({ viseme: azureVisemeToOculus(event.id), time: event.time }));
}
