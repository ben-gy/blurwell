// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/** Shared types for Blurwell. */

/**
 * A rectangle in *normalised* coordinates (0..1 relative to the frame), so a
 * box survives resizing between the preview and the full-resolution render.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A face found by the detector. */
export interface Detection {
  box: Box;
  score: number;
}

/** A box the user drew by hand (licence plate, name badge, screen…). */
export interface ManualRegion {
  id: string;
  box: Box;
}

export type RedactionStyle = 'blur' | 'pixelate' | 'solid';

export interface Settings {
  style: RedactionStyle;
  /** 0..1 — maps to blur radius / pixel size. */
  strength: number;
  /** 0..1 — fraction of box size added as margin on each side. */
  padding: number;
  /** How long (ms) a video detection stays alive after its last sighting. */
  persistenceMs: number;
  /** 0..1 — detector confidence floor. */
  minConfidence: number;
  /** Drop the audio track on export (voices identify people too). */
  removeAudio: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  style: 'blur',
  strength: 0.75,
  padding: 0.18,
  persistenceMs: 400,
  minConfidence: 0.4,
  removeAudio: false,
};

export type MediaKind = 'image' | 'video';

export interface SourceInfo {
  kind: MediaKind;
  name: string;
  size: number;
  width: number;
  height: number;
  /** Video only, in seconds. */
  duration?: number;
  frameRate?: number;
  hasAudio?: boolean;
  audioCodec?: string | null;
}

/** Messages sent from the UI into the worker. */
export type WorkerRequest =
  | { type: 'probe'; file: File }
  | { type: 'detect-frame'; bitmap: ImageBitmap; minConfidence: number }
  | { type: 'render-image'; file: File; boxes: Box[]; settings: Settings; mimeType: string }
  | { type: 'render-video'; file: File; manual: Box[]; settings: Settings }
  | { type: 'cancel' };

/** Messages sent from the worker back to the UI. */
export type WorkerResponse =
  | { type: 'probed'; info: SourceInfo }
  | { type: 'detected'; detections: Detection[]; bitmap: ImageBitmap }
  | { type: 'progress'; phase: string; ratio: number; detail?: string }
  | { type: 'log'; level: LogLevel; message: string }
  | { type: 'image-done'; blob: Blob }
  | { type: 'video-done'; blob: Blob; framesProcessed: number; facesFound: number }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

export type LogLevel = 'info' | 'good' | 'warn' | 'bad';
