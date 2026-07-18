import { describe, expect, it } from 'vitest';
import { DetectionTimeline } from '../src/timeline';
import { boxContains } from '../src/geometry';
import type { Box } from '../src/types';

const face: Box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
const other: Box = { x: 0.05, y: 0.05, w: 0.1, h: 0.1 };

describe('DetectionTimeline', () => {
  it('starts empty', () => {
    const timeline = new DetectionTimeline();
    expect(timeline.isEmpty).toBe(true);
    expect(timeline.detectionCount).toBe(0);
    expect(timeline.regionsAt(0, 0.4, 0)).toEqual([]);
  });

  it('ignores empty detection sets so gaps stay gaps', () => {
    const timeline = new DetectionTimeline();
    timeline.add(1, []);
    expect(timeline.isEmpty).toBe(true);
    expect(timeline.frameCount).toBe(0);
  });

  it('counts detections and frames separately', () => {
    const timeline = new DetectionTimeline();
    timeline.add(0, [face, other]);
    timeline.add(1, [face]);
    expect(timeline.frameCount).toBe(2);
    expect(timeline.detectionCount).toBe(3);
  });

  it('returns a box at the exact timestamp it was recorded', () => {
    const timeline = new DetectionTimeline();
    timeline.add(2, [face]);
    expect(timeline.rawBoxesAt(2, 0)).toHaveLength(1);
  });

  // The core of the anti-flicker design.
  it('covers a frame *before* the face was first detected', () => {
    const timeline = new DetectionTimeline();
    timeline.add(1.0, [face]);
    // A frame a fifth of a second earlier, where the detector saw nothing.
    const regions = timeline.regionsAt(0.8, 0.4, 0);
    expect(regions).toHaveLength(1);
    expect(boxContains(regions[0], 0.5, 0.5)).toBe(true);
  });

  it('covers a frame *after* the face was last detected', () => {
    const timeline = new DetectionTimeline();
    timeline.add(1.0, [face]);
    expect(timeline.regionsAt(1.3, 0.4, 0)).toHaveLength(1);
  });

  it('bridges a detection gap in the middle of a run', () => {
    const timeline = new DetectionTimeline();
    // Detected at 1.0 and 1.4 but missed at 1.2 — the gap must stay covered.
    timeline.add(1.0, [face]);
    timeline.add(1.4, [face]);
    expect(timeline.regionsAt(1.2, 0.4, 0).length).toBeGreaterThan(0);
  });

  it('stops covering once the window has fully elapsed', () => {
    const timeline = new DetectionTimeline();
    timeline.add(1.0, [face]);
    expect(timeline.regionsAt(2.0, 0.4, 0)).toEqual([]);
  });

  it('shrinks coverage as the persistence window shrinks', () => {
    const timeline = new DetectionTimeline();
    timeline.add(1.0, [face]);
    expect(timeline.regionsAt(1.3, 0.4, 0)).toHaveLength(1);
    expect(timeline.regionsAt(1.3, 0.1, 0)).toHaveLength(0);
  });

  it('merges the same face seen across several nearby frames into one region', () => {
    const timeline = new DetectionTimeline();
    timeline.add(1.0, [face]);
    timeline.add(1.05, [{ ...face, x: face.x + 0.01 }]);
    timeline.add(1.1, [{ ...face, x: face.x + 0.02 }]);
    expect(timeline.regionsAt(1.05, 0.4, 0)).toHaveLength(1);
  });

  it('keeps two faces in different parts of the frame separate', () => {
    const timeline = new DetectionTimeline();
    timeline.add(1.0, [face, other]);
    expect(timeline.regionsAt(1.0, 0.4, 0)).toHaveLength(2);
  });

  it('applies padding to the regions it returns', () => {
    const timeline = new DetectionTimeline();
    timeline.add(1.0, [face]);
    const [tight] = timeline.regionsAt(1.0, 0.4, 0);
    const [padded] = timeline.regionsAt(1.0, 0.4, 0.5);
    expect(padded.w).toBeGreaterThan(tight.w);
    expect(padded.h).toBeGreaterThan(tight.h);
  });

  it('sorts out-of-order samples before querying', () => {
    const timeline = new DetectionTimeline();
    timeline.add(2.0, [face]);
    timeline.add(0.5, [other]);
    // Without sorting, the early-exit in rawBoxesAt would miss the later sample.
    expect(timeline.rawBoxesAt(2.0, 0.1)).toHaveLength(1);
    expect(timeline.rawBoxesAt(0.5, 0.1)).toHaveLength(1);
  });

  it('does not return boxes from far outside the window on a long timeline', () => {
    const timeline = new DetectionTimeline();
    for (let t = 0; t < 10; t += 0.1) timeline.add(t, [face]);
    // 0.2s window at t=5 → roughly the samples in [4.8, 5.2].
    const raw = timeline.rawBoxesAt(5, 0.2);
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.length).toBeLessThanOrEqual(6);
  });
});
