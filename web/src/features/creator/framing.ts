import type { CameraFocus } from '@/features/avatar/cameraFocus';

/** Framings offered over the creator stage, widest first ("Tam boy", "Büst", "Yüz"). */
export const CAMERA_PRESETS = ['body', 'torso', 'head'] as const satisfies readonly CameraFocus[];
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

/**
 * The framing the creator stage shows. A framing the editor itself needs (the
 * "Bitti" portrait for the card thumbnail) beats the one picked over the
 * stage, which beats the category's own. A picked preset only lasts until the
 * next category: every category still moves the camera to what it edits.
 */
export function resolveFocus(
  doneOverride: CameraFocus | null,
  preset: CameraFocus | null,
  categoryFocus: CameraFocus,
): CameraFocus {
  return doneOverride ?? preset ?? categoryFocus;
}
