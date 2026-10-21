/** Largest thumbnail the repository accepts (MAX_THUMBNAIL_BYTES, 512 KB). */
const MAX_BYTES = 512 * 1024;
const WIDTH = 480;
const HEIGHT = 640;

/** Bytes of the payload of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A 3:4 portrait crop of the part of the canvas not covered by the panel:
 * full visible height minus a small margin, centred horizontally.
 */
export function portraitCrop(
  canvasWidth: number,
  canvasHeight: number,
  coveredLeft: number,
): CropRect {
  const visibleX = Math.min(Math.max(0, coveredLeft), canvasWidth - 1);
  const visibleWidth = canvasWidth - visibleX;
  const height = Math.min(canvasHeight * 0.94, (visibleWidth * 4) / 3);
  const width = (height * 3) / 4;
  return {
    x: visibleX + (visibleWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Captures a 3:4 WebP portrait of the stage canvas (rendered with
 * preserveDrawingBuffer), at most 512 KB. `panelWidth` is in CSS pixels.
 * Returns undefined when the browser cannot encode WebP.
 */
export function captureThumbnail(
  canvas: HTMLCanvasElement,
  panelWidth: number,
): string | undefined {
  const scale = canvas.width / Math.max(1, canvas.clientWidth);
  const crop = portraitCrop(canvas.width, canvas.height, panelWidth * scale);
  const out = document.createElement('canvas');
  out.width = WIDTH;
  out.height = HEIGHT;
  const context = out.getContext('2d');
  if (!context) return undefined;
  context.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, WIDTH, HEIGHT);
  for (const quality of [0.88, 0.78, 0.66, 0.5]) {
    const url = out.toDataURL('image/webp', quality);
    if (!url.startsWith('data:image/webp')) return undefined;
    if (dataUrlBytes(url) <= MAX_BYTES) return url;
  }
  return undefined;
}
