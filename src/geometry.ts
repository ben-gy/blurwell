/**
 * Box maths. All boxes are normalised (0..1) unless a function says otherwise.
 *
 * Blurwell deliberately errs towards *over*-covering: a box that is slightly
 * too big is a cosmetic problem, a box that is slightly too small is a privacy
 * failure. Every helper here is written with that bias.
 */

import type { Box } from './types';

/** Clamps a box into the unit square, preserving as much area as possible. */
export function clampBox(box: Box): Box {
  const x = Math.min(Math.max(box.x, 0), 1);
  const y = Math.min(Math.max(box.y, 0), 1);
  const right = Math.min(Math.max(box.x + box.w, 0), 1);
  const bottom = Math.min(Math.max(box.y + box.h, 0), 1);
  return { x, y, w: Math.max(right - x, 0), h: Math.max(bottom - y, 0) };
}

/**
 * Grows a box by `padding` (a fraction of its own size) on every side.
 * BlazeFace returns a tight crop around the facial features — without padding,
 * hair, chin and ears stay visible, which is enough to recognise someone.
 */
export function padBox(box: Box, padding: number): Box {
  const dx = box.w * padding;
  const dy = box.h * padding;
  return clampBox({
    x: box.x - dx,
    y: box.y - dy,
    w: box.w + dx * 2,
    h: box.h + dy * 2,
  });
}

/** Area of a box. */
export function area(box: Box): number {
  return Math.max(box.w, 0) * Math.max(box.h, 0);
}

/** Area of the overlap between two boxes (0 if they don't touch). */
export function intersectionArea(a: Box, b: Box): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(right - x, 0) * Math.max(bottom - y, 0);
}

/** Intersection-over-union — the standard box similarity measure. */
export function iou(a: Box, b: Box): number {
  const inter = intersectionArea(a, b);
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** The smallest box containing both inputs. */
export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * How much of the *smaller* box is swallowed by the other, 0..1.
 *
 * This, rather than IoU, is the right measure for deciding whether to merge:
 * IoU falls off sharply when two boxes differ in size, so a small face box
 * sitting almost entirely inside a large merged region would score low and be
 * left separate — the opposite of what we want.
 */
export function containmentRatio(a: Box, b: Box): number {
  const smaller = Math.min(area(a), area(b));
  return smaller <= 0 ? 0 : intersectionArea(a, b) / smaller;
}

/**
 * Merges boxes that substantially overlap into their union.
 *
 * Padding two adjacent faces makes their boxes overlap, and blurring each one
 * separately blurs the shared strip twice, which shows up as a visible seam.
 * Collapsing them into a single region avoids that. Runs until the set is
 * stable, because merging two boxes can produce a box that now overlaps a third.
 */
export function mergeOverlapping(boxes: Box[], threshold = 0.2): Box[] {
  let current = boxes.map(clampBox).filter((b) => area(b) > 0);
  let merged = true;

  while (merged) {
    merged = false;
    const next: Box[] = [];

    for (const box of current) {
      const hitIndex = next.findIndex((existing) => containmentRatio(existing, box) > threshold);
      if (hitIndex === -1) {
        next.push(box);
      } else {
        next[hitIndex] = unionBox(next[hitIndex], box);
        merged = true;
      }
    }

    current = next;
  }

  return current;
}

/** Converts a normalised box to pixel coordinates, rounded outwards. */
export function toPixels(box: Box, width: number, height: number) {
  const x = Math.floor(box.x * width);
  const y = Math.floor(box.y * height);
  const right = Math.ceil((box.x + box.w) * width);
  const bottom = Math.ceil((box.y + box.h) * height);
  return { x, y, w: Math.max(right - x, 0), h: Math.max(bottom - y, 0) };
}

/** Builds a normalised box from two corner points in pixel space (any order). */
export function boxFromPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  height: number,
): Box {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return clampBox({
    x: left / width,
    y: top / height,
    w: Math.abs(x2 - x1) / width,
    h: Math.abs(y2 - y1) / height,
  });
}

/** True if a normalised point falls inside a box. */
export function boxContains(box: Box, px: number, py: number): boolean {
  return px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
}
