// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * The detection timeline — Blurwell's answer to detector flicker.
 *
 * A face detector run independently on each frame *will* miss faces on some
 * frames: a head turn, motion blur, a partial crop. Each miss is a frame of
 * un-blurred face in the exported file, which defeats the whole point of the
 * tool. Publishing a video where one frame in forty shows the face is barely
 * better than publishing it unredacted.
 *
 * So Blurwell scans the whole video first, records every detection against its
 * timestamp, and then — during the render pass — covers each frame with every
 * box seen within a window *either side* of it. A face missed for a few frames
 * stays covered by its neighbours' boxes. The two-pass design is what makes the
 * window bidirectional; a single-pass tool can only extend coverage forwards,
 * leaving the frames just before a face is first picked up exposed.
 */

import { mergeOverlapping, padBox } from './geometry';
import type { Box } from './types';

interface Sample {
  t: number;
  boxes: Box[];
}

export class DetectionTimeline {
  private samples: Sample[] = [];
  private sorted = true;

  /** Records the boxes detected at timestamp `t` (seconds). */
  add(t: number, boxes: Box[]): void {
    if (boxes.length === 0) return;
    const last = this.samples[this.samples.length - 1];
    if (last && t < last.t) this.sorted = false;
    this.samples.push({ t, boxes });
  }

  /** Total number of detections recorded across all frames. */
  get detectionCount(): number {
    return this.samples.reduce((sum, s) => sum + s.boxes.length, 0);
  }

  /** Number of frames that contained at least one detection. */
  get frameCount(): number {
    return this.samples.length;
  }

  get isEmpty(): boolean {
    return this.samples.length === 0;
  }

  private ensureSorted(): void {
    if (this.sorted) return;
    this.samples.sort((a, b) => a.t - b.t);
    this.sorted = true;
  }

  /**
   * Every box recorded within `windowSec` either side of `t`, raw and unmerged.
   */
  rawBoxesAt(t: number, windowSec: number): Box[] {
    this.ensureSorted();
    const out: Box[] = [];
    for (const sample of this.samples) {
      // Samples are sorted, so we can stop once we're past the window.
      if (sample.t > t + windowSec) break;
      if (sample.t >= t - windowSec) out.push(...sample.boxes);
    }
    return out;
  }

  /**
   * The redaction regions to paint over the frame at time `t`: every box within
   * the persistence window, padded outwards, with overlapping boxes merged so
   * no un-blurred seam appears between two adjacent faces.
   */
  regionsAt(t: number, windowSec: number, padding: number): Box[] {
    const raw = this.rawBoxesAt(t, windowSec);
    if (raw.length === 0) return [];
    return mergeOverlapping(raw.map((b) => padBox(b, padding)));
  }
}
