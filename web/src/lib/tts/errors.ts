export type TtsFailureKind =
  'auth' | 'rate_limit' | 'network' | 'timeout' | 'bad_request' | 'service' | 'aborted' | 'unknown';

/** Carries a coarse kind only: SDK error details can echo request data, so they are dropped. */
export class TtsError extends Error {
  readonly kind: TtsFailureKind;

  constructor(kind: TtsFailureKind) {
    super(`Text-to-speech failed: ${kind}`);
    this.name = 'TtsError';
    this.kind = kind;
  }
}
