// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * The face detector — MediaPipe BlazeFace (short range), running on WASM.
 *
 * Both the model and the WASM runtime are served from our own origin
 * (`public/models`, `public/mediapipe-wasm`) rather than Google's CDN. That is
 * a deliberate privacy decision: a CDN fetch would leak the fact that you are
 * anonymising something, and it would break the "works with the network off"
 * guarantee that makes the privacy claim checkable.
 *
 * This module never sees the network and never produces an identity — only
 * rectangles. There are no embeddings and no recognition anywhere in Blurwell.
 */

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Box, Detection } from './types';

const WASM_PATH = '/mediapipe-wasm';
const MODEL_PATH = '/models/blaze_face_short_range.tflite';

export type RunningMode = 'IMAGE' | 'VIDEO';

let detector: FaceDetector | null = null;
let currentMode: RunningMode | null = null;
let loading: Promise<FaceDetector> | null = null;

/** Anything MediaPipe can run inference against. */
export type DetectInput = ImageBitmap | OffscreenCanvas | HTMLCanvasElement;

async function createDetector(mode: RunningMode): Promise<FaceDetector> {
  const [vision, modelResponse] = await Promise.all([
    FilesetResolver.forVisionTasks(WASM_PATH),
    fetch(MODEL_PATH),
  ]);

  if (!modelResponse.ok) {
    throw new Error(`Could not load the face model (HTTP ${modelResponse.status}).`);
  }
  const modelBuffer = new Uint8Array(await modelResponse.arrayBuffer());

  // GPU delegate is markedly faster per frame, but is not available in every
  // worker/driver combination — fall back to CPU rather than failing the run.
  try {
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate: 'GPU' },
      runningMode: mode,
    });
  } catch {
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate: 'CPU' },
      runningMode: mode,
    });
  }
}

/** Loads (once) and returns a detector configured for `mode`. */
export async function getDetector(mode: RunningMode): Promise<FaceDetector> {
  if (detector && currentMode === mode) return detector;

  if (!detector) {
    loading ??= createDetector(mode);
    detector = await loading;
    currentMode = mode;
    return detector;
  }

  // Same instance, different running mode — cheaper than rebuilding it.
  await detector.setOptions({ runningMode: mode });
  currentMode = mode;
  return detector;
}

/** Releases the detector and its WASM heap. */
export function closeDetector(): void {
  detector?.close();
  detector = null;
  currentMode = null;
  loading = null;
}

/**
 * MediaPipe reports boxes in source pixels; we normalise them so a box found on
 * a downscaled detection frame still lines up on the full-resolution render.
 */
function toNormalised(
  raw: { originX: number; originY: number; width: number; height: number },
  width: number,
  height: number,
): Box {
  return {
    x: raw.originX / width,
    y: raw.originY / height,
    w: raw.width / width,
    h: raw.height / height,
  };
}

function mapDetections(
  result: { detections: Array<{ boundingBox?: unknown; categories?: Array<{ score: number }> }> },
  width: number,
  height: number,
  minConfidence: number,
): Detection[] {
  const out: Detection[] = [];

  for (const det of result.detections ?? []) {
    const bb = det.boundingBox as
      | { originX: number; originY: number; width: number; height: number }
      | undefined;
    if (!bb) continue;

    const score = det.categories?.[0]?.score ?? 1;
    if (score < minConfidence) continue;

    const box = toNormalised(bb, width, height);
    if (box.w <= 0 || box.h <= 0) continue;

    out.push({ box, score });
  }

  return out;
}

/** Detects faces in a still image. */
export async function detectImage(
  input: DetectInput,
  width: number,
  height: number,
  minConfidence: number,
): Promise<Detection[]> {
  const faceDetector = await getDetector('IMAGE');
  const result = faceDetector.detect(input);
  return mapDetections(result, width, height, minConfidence);
}

/**
 * Detects faces in one video frame. `timestampMs` must increase monotonically
 * across calls — MediaPipe rejects out-of-order timestamps in VIDEO mode.
 */
export async function detectVideoFrame(
  input: DetectInput,
  timestampMs: number,
  width: number,
  height: number,
  minConfidence: number,
): Promise<Detection[]> {
  const faceDetector = await getDetector('VIDEO');
  const result = faceDetector.detectForVideo(input, timestampMs);
  return mapDetections(result, width, height, minConfidence);
}
