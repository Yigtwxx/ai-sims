'use client';

import type { SpeechPlayer } from '@/features/lipsync/speechPlayer';
import type { CharacterConfig } from '@/lib/character/schema';
import type { MhManifest } from '@/lib/assets/manifest';

import type { CameraFocus } from '../cameraFocus';
import { Stage } from '../Stage';

/**
 * Public interface of the photoreal MetaHuman stage. Pages (creator, talk, landing
 * hero, thumbnails) render this component only; everything inside (loading,
 * assembly, materials, life and lip-sync) belongs to the avatar feature.
 */
export interface MhStageProps {
  config: CharacterConfig;
  manifest: MhManifest;
  /**
   * creator: idle life + reactions to edits, drag to turn.
   * talk: full-body framing by default, zoom and turn, lip-sync from `speech`.
   * hero: landing hero, slow presentation, no interaction.
   * thumbnail: still render for capturing item and character thumbnails.
   */
  mode: 'creator' | 'talk' | 'hero' | 'thumbnail';
  /** Camera framing; creator categories map to body/face/torso/legs/feet. */
  focus?: CameraFocus;
  /** Talk mode: user zoom from full body (0) to face close-up (1). */
  zoom?: number;
  /** Talk mode: drives visemes, jaw and speaking gestures while it plays. */
  speech?: SpeechPlayer | null;
  /** Talk mode: the model is composing a reply (thinking gaze and gestures). */
  thinking?: boolean;
  /** Pixels covered by a panel on the left so the character centres in the rest. */
  insetLeft?: number;
  /** Pixels covered by a panel on the right (talk mode chat). */
  insetRight?: number;
  /** Fired once the character is assembled and the first frame is on screen. */
  onReady?: () => void;
  className?: string;
}

/**
 * Temporary body: the studio stage without a character, until the MetaHuman
 * assembly lands (same props, so pages do not change when it does).
 */
export function MhStage({ focus = 'body', insetLeft = 0, className }: MhStageProps) {
  return (
    <Stage focus={focus} insetLeft={insetLeft} backdrop="dark" className={className}>
      {null}
    </Stage>
  );
}
