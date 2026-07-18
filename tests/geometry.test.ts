import { describe, expect, it } from 'vitest';
import {
  area,
  boxContains,
  boxFromPoints,
  clampBox,
  intersectionArea,
  iou,
  mergeOverlapping,
  padBox,
  toPixels,
  unionBox,
} from '../src/geometry';

describe('clampBox', () => {
  it('leaves an in-bounds box alone', () => {
    const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.1 };
    const clamped = clampBox(box);
    expect(clamped.x).toBeCloseTo(box.x, 10);
    expect(clamped.y).toBeCloseTo(box.y, 10);
    expect(clamped.w).toBeCloseTo(box.w, 10);
    expect(clamped.h).toBeCloseTo(box.h, 10);
  });

  it('trims a box that overhangs the right and bottom edges', () => {
    expect(clampBox({ x: 0.8, y: 0.9, w: 0.5, h: 0.5 })).toEqual({
      x: 0.8,
      y: 0.9,
      w: expect.closeTo(0.2, 10),
      h: expect.closeTo(0.1, 10),
    });
  });

  it('trims a box with negative origin without moving its far edge', () => {
    const result = clampBox({ x: -0.2, y: -0.1, w: 0.5, h: 0.5 });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.w).toBeCloseTo(0.3, 10);
    expect(result.h).toBeCloseTo(0.4, 10);
  });

  it('collapses a box entirely outside the frame to zero area', () => {
    expect(area(clampBox({ x: 1.5, y: 1.5, w: 0.2, h: 0.2 }))).toBe(0);
  });
});

describe('padBox', () => {
  it('grows the box by the given fraction on every side', () => {
    const padded = padBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 0.5);
    expect(padded.x).toBeCloseTo(0.3, 10);
    expect(padded.y).toBeCloseTo(0.3, 10);
    expect(padded.w).toBeCloseTo(0.4, 10);
    expect(padded.h).toBeCloseTo(0.4, 10);
  });

  it('is a no-op at zero padding', () => {
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const padded = padBox(box, 0);
    expect(padded.x).toBeCloseTo(box.x, 10);
    expect(padded.y).toBeCloseTo(box.y, 10);
    expect(padded.w).toBeCloseTo(box.w, 10);
    expect(padded.h).toBeCloseTo(box.h, 10);
  });

  it('never grows outside the frame', () => {
    const padded = padBox({ x: 0.05, y: 0.05, w: 0.2, h: 0.2 }, 1);
    expect(padded.x).toBe(0);
    expect(padded.y).toBe(0);
    expect(padded.x + padded.w).toBeLessThanOrEqual(1);
    expect(padded.y + padded.h).toBeLessThanOrEqual(1);
  });

  it('only ever covers more area, never less — under-covering is a privacy bug', () => {
    const box = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 };
    for (const padding of [0, 0.05, 0.18, 0.4, 0.9]) {
      expect(area(padBox(box, padding))).toBeGreaterThanOrEqual(area(box) - 1e-12);
    }
  });
});

describe('intersectionArea / iou', () => {
  it('reports zero for disjoint boxes', () => {
    const a = { x: 0, y: 0, w: 0.2, h: 0.2 };
    const b = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(intersectionArea(a, b)).toBe(0);
    expect(iou(a, b)).toBe(0);
  });

  it('reports 1 for identical boxes', () => {
    const a = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    expect(iou(a, { ...a })).toBeCloseTo(1, 10);
  });

  it('reports zero for boxes that merely touch at an edge', () => {
    expect(intersectionArea({ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.2, y: 0, w: 0.2, h: 0.2 })).toBe(
      0,
    );
  });

  it('computes a known partial overlap', () => {
    const a = { x: 0, y: 0, w: 0.2, h: 0.2 };
    const b = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(intersectionArea(a, b)).toBeCloseTo(0.01, 10);
    // union = 0.04 + 0.04 - 0.01 = 0.07
    expect(iou(a, b)).toBeCloseTo(0.01 / 0.07, 10);
  });

  it('handles zero-area boxes without dividing by zero', () => {
    expect(iou({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(0);
  });
});

describe('unionBox', () => {
  it('spans both inputs', () => {
    const result = unionBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.4, w: 0.2, h: 0.2 });
    expect(result).toEqual({
      x: 0.1,
      y: 0.1,
      w: expect.closeTo(0.6, 10),
      h: expect.closeTo(0.5, 10),
    });
  });
});

describe('mergeOverlapping', () => {
  it('leaves disjoint boxes untouched', () => {
    const boxes = [
      { x: 0, y: 0, w: 0.2, h: 0.2 },
      { x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
    ];
    expect(mergeOverlapping(boxes)).toHaveLength(2);
  });

  it('merges two heavily overlapping boxes into one', () => {
    const merged = mergeOverlapping([
      { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      { x: 0.15, y: 0.15, w: 0.3, h: 0.3 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].x).toBeCloseTo(0.1, 10);
    expect(merged[0].w).toBeCloseTo(0.35, 10);
  });

  it('collapses a transitive chain — merging A+B can then reach C', () => {
    // A overlaps B, B overlaps C, but A and C do not touch each other.
    const merged = mergeOverlapping([
      { x: 0.0, y: 0, w: 0.2, h: 0.2 },
      { x: 0.15, y: 0, w: 0.2, h: 0.2 },
      { x: 0.3, y: 0, w: 0.2, h: 0.2 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].x).toBeCloseTo(0, 10);
    expect(merged[0].w).toBeCloseTo(0.5, 10);
  });

  it('never loses coverage — every input point stays inside some output box', () => {
    const inputs = [
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { x: 0.2, y: 0.15, w: 0.2, h: 0.2 },
      { x: 0.7, y: 0.7, w: 0.1, h: 0.1 },
    ];
    const merged = mergeOverlapping(inputs);
    for (const input of inputs) {
      const corners: Array<[number, number]> = [
        [input.x, input.y],
        [input.x + input.w, input.y],
        [input.x, input.y + input.h],
        [input.x + input.w, input.y + input.h],
      ];
      for (const [px, py] of corners) {
        expect(merged.some((box) => boxContains(box, px, py))).toBe(true);
      }
    }
  });

  it('drops zero-area boxes', () => {
    expect(mergeOverlapping([{ x: 0.5, y: 0.5, w: 0, h: 0 }])).toHaveLength(0);
  });

  it('handles an empty list', () => {
    expect(mergeOverlapping([])).toEqual([]);
  });
});

describe('toPixels', () => {
  it('converts a normalised box to pixel coordinates', () => {
    expect(toPixels({ x: 0.5, y: 0.5, w: 0.25, h: 0.5 }, 800, 400)).toEqual({
      x: 400,
      y: 200,
      w: 200,
      h: 200,
    });
  });

  it('rounds outwards so a partial pixel is still covered', () => {
    const result = toPixels({ x: 0.101, y: 0.101, w: 0.1, h: 0.1 }, 100, 100);
    expect(result.x).toBe(10);
    expect(result.w).toBeGreaterThanOrEqual(10);
  });
});

describe('boxFromPoints', () => {
  it('normalises regardless of drag direction', () => {
    const forward = boxFromPoints(10, 20, 60, 80, 100, 100);
    const backward = boxFromPoints(60, 80, 10, 20, 100, 100);
    expect(forward).toEqual(backward);
    expect(forward.x).toBeCloseTo(0.1, 10);
    expect(forward.w).toBeCloseTo(0.5, 10);
  });

  it('clamps a drag that leaves the frame', () => {
    const box = boxFromPoints(-50, -50, 50, 50, 100, 100);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.w).toBeCloseTo(0.5, 10);
  });
});

describe('boxContains', () => {
  const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

  it('accepts an interior point', () => {
    expect(boxContains(box, 0.4, 0.4)).toBe(true);
  });

  it('accepts the boundary', () => {
    expect(boxContains(box, 0.2, 0.2)).toBe(true);
    expect(boxContains(box, 0.6, 0.6)).toBe(true);
  });

  it('rejects an outside point', () => {
    expect(boxContains(box, 0.1, 0.4)).toBe(false);
    expect(boxContains(box, 0.7, 0.4)).toBe(false);
  });
});
