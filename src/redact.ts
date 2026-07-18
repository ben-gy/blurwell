/**
 * Burning the redaction into the pixels.
 *
 * Nothing here is an overlay: every mode destroys the underlying image data in
 * the output canvas, so the exported file cannot be "un-blurred" by stripping a
 * layer. (The user's original file on disk is of course untouched.)
 */

import { toPixels } from './geometry';
import type { Box, RedactionStyle, Settings } from './types';

/** Any 2D context we can draw into — DOM canvas or OffscreenCanvas. */
export type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Maps the 0..1 strength slider to a gaussian blur radius in pixels, scaled by
 * the size of the region. A fixed radius under-blurs a large close-up face and
 * destroys a small distant one, so the radius tracks the region's own size.
 */
export function blurRadiusFor(box: Box, width: number, height: number, strength: number): number {
  const { w, h } = toPixels(box, width, height);
  const base = Math.max(w, h);
  // 6%..30% of the region's largest side, floored so tiny faces still vanish.
  const fraction = 0.06 + clamp01(strength) * 0.24;
  return Math.max(4, Math.round(base * fraction));
}

/**
 * Maps strength to a pixelation block size. Fewer, larger blocks = stronger.
 * Capped at 24 blocks across so a face never survives as a recognisable mosaic.
 */
export function pixelSizeFor(box: Box, width: number, height: number, strength: number): number {
  const { w, h } = toPixels(box, width, height);
  const base = Math.max(w, h);
  const blocks = Math.round(24 - clamp01(strength) * 18); // 24 → 6 blocks
  return Math.max(2, Math.round(base / Math.max(blocks, 1)));
}

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1);
}

/**
 * Paints one region. `source` is the already-drawn frame; we sample from it and
 * write the redacted result back over the same area of `ctx`.
 */
function redactRegion(
  ctx: AnyContext2D,
  source: CanvasImageSource,
  box: Box,
  width: number,
  height: number,
  style: RedactionStyle,
  strength: number,
): void {
  const { x, y, w, h } = toPixels(box, width, height);
  if (w <= 0 || h <= 0) return;

  ctx.save();
  // Clip so the blur can sample beyond the box edges without bleeding outside
  // it — otherwise a strong blur smears a halo across the whole frame.
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (style === 'solid') {
    ctx.filter = 'none';
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, w, h);
  } else if (style === 'blur') {
    const radius = blurRadiusFor(box, width, height, strength);
    ctx.filter = `blur(${radius}px)`;
    // Draw the whole frame through the blur filter; the clip keeps only the
    // region. Sampling the full frame means edge pixels blur against real
    // neighbours rather than transparent black.
    ctx.drawImage(source, 0, 0, width, height);
  } else {
    const pixel = pixelSizeFor(box, width, height, strength);
    const smallW = Math.max(1, Math.round(w / pixel));
    const smallH = Math.max(1, Math.round(h / pixel));
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = false;
    // Down-sample the region into a tiny area, then blow it back up. Drawing
    // via the destination canvas itself avoids allocating a scratch canvas per
    // region per frame.
    ctx.drawImage(source, x, y, w, h, x, y, smallW, smallH);
    ctx.drawImage(ctx.canvas as unknown as CanvasImageSource, x, y, smallW, smallH, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  ctx.restore();
  ctx.filter = 'none';
}

/**
 * Draws `source` into `ctx` and redacts every box. Boxes are expected to be
 * already padded and merged (see {@link DetectionTimeline.regionsAt}).
 */
export function renderRedacted(
  ctx: AnyContext2D,
  source: CanvasImageSource,
  boxes: Box[],
  width: number,
  height: number,
  settings: Pick<Settings, 'style' | 'strength'>,
): void {
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  for (const box of boxes) {
    redactRegion(ctx, source, box, width, height, settings.style, settings.strength);
  }
}

/**
 * Pixelation needs to read back from the destination canvas, which is only safe
 * once the frame has been drawn. Exposed for tests and for callers that want to
 * redact an already-composited canvas in place.
 */
export { redactRegion };
