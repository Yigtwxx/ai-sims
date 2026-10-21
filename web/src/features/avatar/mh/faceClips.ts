/**
 * Face animation clips from the converter: MetaHuman face loops (idle,
 * expression loops) fitted to ARKit weights per frame, as JSON
 * `{ fps, duration, loop, names, frames }` (frames[i][k] is names[k] at i / fps).
 * Eye rotations in the files are ignored: gaze and blinks are driven live.
 */

export interface FaceClip {
  fps: number;
  duration: number;
  loop: boolean;
  names: string[];
  frames: number[][];
}

/** Driven by the life layer itself (gaze, blinks); never taken from a clip. */
const LIVE_CHANNELS = /^(eyeBlink|eyeLook)/;
/** Mouth and jaw channels, damped while lip-sync speaks. */
export const MOUTH_CHANNELS = /^(mouth|jaw)/;

/**
 * Adds `weight` × the clip's weights at time `t` (seconds; looped clips wrap,
 * others hold the last frame) into `out`, skipping the live channels.
 * `mouthScale` multiplies mouth and jaw channels.
 */
export function addFaceClip(
  clip: FaceClip,
  t: number,
  weight: number,
  out: Map<string, number>,
  mouthScale = 1,
): void {
  const count = clip.frames.length;
  if (count === 0 || weight === 0) return;
  const span = count / clip.fps;
  const time = clip.loop ? ((t % span) + span) % span : Math.min(Math.max(t, 0), span);
  // A loop's last frame blends back into its first; a one-shot holds its last.
  const position = clip.loop ? time * clip.fps : Math.min(time * clip.fps, count - 1);
  const i = Math.floor(position);
  const next = clip.loop ? (i + 1) % count : Math.min(i + 1, count - 1);
  const f = position - i;
  const a = clip.frames[i]!;
  const b = clip.frames[next]!;
  clip.names.forEach((name, k) => {
    if (LIVE_CHANNELS.test(name)) return;
    const value = (a[k]! * (1 - f) + b[k]! * f) * weight;
    if (value === 0) return;
    const scaled = MOUTH_CHANNELS.test(name) ? value * mouthScale : value;
    out.set(name, (out.get(name) ?? 0) + scaled);
  });
}

const clips = new Map<string, Promise<FaceClip>>();

/** Fetches a face clip once per URL; a failed request is retried by the next caller. */
export function loadFaceClip(url: string): Promise<FaceClip> {
  let pending = clips.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Face clip ${url}: HTTP ${response.status}`);
      return (await response.json()) as FaceClip;
    });
    pending.catch(() => clips.delete(url));
    clips.set(url, pending);
  }
  return pending;
}
