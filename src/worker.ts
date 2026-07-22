/// <reference lib="webworker" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * The whole pipeline — probe, detect, redact, encode — runs here so the main
 * thread never blocks. Progress is streamed back by `postMessage`; nothing in
 * this file touches `requestAnimationFrame`, because a backgrounded tab stops
 * firing it and would stall a long render indefinitely.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  getFirstEncodableVideoCodec,
} from 'mediabunny';

import { closeDetector, detectImage, detectVideoFrame } from './detector';
import { mergeOverlapping, padBox } from './geometry';
import { renderRedacted } from './redact';
import { DetectionTimeline } from './timeline';
import type { Box, LogLevel, Settings, SourceInfo, WorkerRequest, WorkerResponse } from './types';

/** Longest side used for the detection pass. */
const SCAN_MAX_DIMENSION = 960;
/** How often we sample the video for faces. The persistence window covers the gaps. */
const SCAN_FPS = 15;
/** Bits per pixel per frame — generous, since anonymising shouldn't also degrade. */
const BITS_PER_PIXEL = 0.1;

let cancelled = false;

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function log(level: LogLevel, message: string): void {
  post({ type: 'log', level, message });
}

function progress(phase: string, ratio: number, detail?: string): void {
  post({ type: 'progress', phase, ratio: Math.min(Math.max(ratio, 0), 1), detail });
}

function throwIfCancelled(): void {
  if (cancelled) throw new CancelledError();
}

class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

/** Scales dimensions so the longest side is at most `max`, preserving aspect. */
function fitWithin(width: number, height: number, max: number) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
  };
}

/** Even dimensions keep H.264 encoders happy. */
function toEven(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}

// ─────────────────────────────────────────────────────────── probing ──

async function probe(file: File): Promise<SourceInfo> {
  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file);
    const info: SourceInfo = {
      kind: 'image',
      name: file.name,
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
    };
    bitmap.close();
    return info;
  }

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('No video track found in this file.');

  const audioTrack = await input.getPrimaryAudioTrack();
  const duration = await input.computeDuration();
  const packetStats = await videoTrack.computePacketStats(120).catch(() => null);

  return {
    kind: 'video',
    name: file.name,
    size: file.size,
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    duration,
    frameRate: packetStats?.averagePacketRate ?? 30,
    hasAudio: !!audioTrack,
    audioCodec: audioTrack?.codec ?? null,
  };
}

// ──────────────────────────────────────────────────────────── images ──

async function detectInFrame(bitmap: ImageBitmap, minConfidence: number): Promise<void> {
  progress('detect', 0.1, 'Loading model');

  // Detect on a downscaled copy — the model resizes its input internally, so a
  // huge frame costs time without improving recall.
  const scanSize = fitWithin(bitmap.width, bitmap.height, SCAN_MAX_DIMENSION);
  const scanCanvas = new OffscreenCanvas(scanSize.width, scanSize.height);
  const scanCtx = scanCanvas.getContext('2d');
  if (!scanCtx) throw new Error('Could not create a drawing context.');
  scanCtx.drawImage(bitmap, 0, 0, scanSize.width, scanSize.height);

  progress('detect', 0.6, 'Scanning for faces');
  const detections = await detectImage(
    scanCanvas,
    scanSize.width,
    scanSize.height,
    minConfidence,
  );

  progress('detect', 1);
  log(
    detections.length > 0 ? 'good' : 'warn',
    detections.length > 0
      ? `Found ${detections.length} face${detections.length === 1 ? '' : 's'}.`
      : 'No faces detected — draw boxes by hand over anything you want covered.',
  );

  post({ type: 'detected', detections, bitmap }, [bitmap]);
}

async function renderImage(
  file: File,
  boxes: Box[],
  settings: Settings,
  mimeType: string,
): Promise<void> {
  progress('render', 0.2, 'Redacting');
  const bitmap = await createImageBitmap(file);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing context.');

  const regions = mergeOverlapping(boxes.map((b) => padBox(b, settings.padding)));
  renderRedacted(ctx, bitmap, regions, bitmap.width, bitmap.height, settings);
  bitmap.close();

  progress('render', 0.8, 'Encoding');
  // Re-encoding from raw pixels is also what drops EXIF/GPS: the output is
  // built from the image data alone, so no original metadata can survive.
  const quality = mimeType === 'image/jpeg' || mimeType === 'image/webp' ? 0.92 : undefined;
  const blob = await canvas.convertToBlob({ type: mimeType, quality });

  progress('render', 1);
  log('good', `Exported ${regions.length} redacted region${regions.length === 1 ? '' : 's'}.`);
  post({ type: 'image-done', blob });
}

// ───────────────────────────────────────────────────────────── video ──

/** Pass 1 — decode the video and record where faces appear over time. */
async function scanVideo(
  file: File,
  settings: Settings,
  duration: number,
): Promise<DetectionTimeline> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('No video track found in this file.');

  const scanSize = fitWithin(videoTrack.displayWidth, videoTrack.displayHeight, SCAN_MAX_DIMENSION);
  const sink = new CanvasSink(videoTrack, {
    width: scanSize.width,
    height: scanSize.height,
    fit: 'fill',
    poolSize: 2,
  });

  const timeline = new DetectionTimeline();
  const step = 1 / SCAN_FPS;
  const timestamps: number[] = [];
  for (let t = 0; t < duration; t += step) timestamps.push(t);

  let scanned = 0;
  // We sample on a fixed 15 Hz grid, but the video's own frames may be sparser
  // (a slideshow, a low-fps screen capture), in which case consecutive sample
  // points resolve to the *same* decoded frame. Detecting on it twice is wasted
  // work, and re-running the graph on a repeated timestamp is an outright error
  // — MediaPipe's VIDEO mode requires strictly increasing timestamps.
  let lastPts = Number.NEGATIVE_INFINITY;
  let lastDetectorMs = Number.NEGATIVE_INFINITY;

  for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
    throwIfCancelled();
    scanned++;
    if (!wrapped) continue;
    if (wrapped.timestamp === lastPts) continue;
    lastPts = wrapped.timestamp;

    // Belt and braces: even with the dedupe above, rounding to whole
    // milliseconds could collide on very high frame rates.
    const detectorMs = Math.max(Math.round(wrapped.timestamp * 1000), lastDetectorMs + 1);
    lastDetectorMs = detectorMs;

    const detections = await detectVideoFrame(
      wrapped.canvas,
      detectorMs,
      scanSize.width,
      scanSize.height,
      settings.minConfidence,
    );

    if (detections.length > 0) {
      timeline.add(wrapped.timestamp, detections.map((d) => d.box));
    }

    if (scanned % 5 === 0 || scanned === timestamps.length) {
      progress(
        'scan',
        scanned / Math.max(timestamps.length, 1),
        `${timeline.detectionCount} face sighting${timeline.detectionCount === 1 ? '' : 's'}`,
      );
    }
  }

  progress('scan', 1);
  return timeline;
}

/** Pass 2 — decode again at full resolution, burn in the blur, re-encode. */
async function renderVideo(file: File, manual: Box[], settings: Settings): Promise<void> {
  const codec = await getFirstEncodableVideoCodec(['avc']);
  if (!codec) {
    throw new Error(
      'This browser cannot encode H.264 video. Try Chrome, Edge or Safari — image redaction still works here.',
    );
  }

  const probeInfo = await probe(file);
  const duration = probeInfo.duration ?? 0;
  if (duration <= 0) throw new Error('Could not read the video duration.');

  log('info', 'Pass 1 of 2 — scanning every frame for faces.');
  const timeline = await scanVideo(file, settings, duration);
  throwIfCancelled();

  log(
    timeline.isEmpty ? 'warn' : 'good',
    timeline.isEmpty
      ? 'No faces detected. Any boxes you drew by hand will still be applied.'
      : `Detected faces across ${timeline.frameCount} sampled frames.`,
  );

  // ── set up the output ──
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('No video track found in this file.');

  const outWidth = toEven(videoTrack.displayWidth);
  const outHeight = toEven(videoTrack.displayHeight);
  const frameRate = probeInfo.frameRate ?? 30;
  const bitrate = Math.round(
    Math.min(Math.max(outWidth * outHeight * frameRate * BITS_PER_PIXEL, 1_000_000), 24_000_000),
  );

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const canvas = new OffscreenCanvas(outWidth, outHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing context.');

  const videoSource = new CanvasSource(canvas, { codec, bitrate });
  output.addVideoTrack(videoSource);

  // ── audio: copy the packets through untouched where the container allows ──
  const audioTrack = settings.removeAudio ? null : await input.getPrimaryAudioTrack();
  const audioCodec = audioTrack?.codec ?? null;
  const audioSupported =
    !!audioCodec && new Mp4OutputFormat().getSupportedCodecs().includes(audioCodec);

  let audioSource: EncodedAudioPacketSource | null = null;
  if (audioTrack && audioCodec && audioSupported) {
    audioSource = new EncodedAudioPacketSource(audioCodec);
    output.addAudioTrack(audioSource);
  } else if (settings.removeAudio) {
    log('info', 'Audio removed — a voice identifies a person as surely as a face.');
  } else if (audioTrack) {
    log('warn', `Audio track is ${audioCodec ?? 'an unknown codec'}, which cannot be copied into MP4. Exporting without audio.`);
  }

  await output.start();

  const windowSec = settings.persistenceMs / 1000;
  const paddedManual = manual.map((b) => padBox(b, settings.padding));

  const sink = new CanvasSink(videoTrack, {
    width: outWidth,
    height: outHeight,
    fit: 'fill',
    poolSize: 2,
  });

  const renderFrames = async () => {
    let frames = 0;
    for await (const wrapped of sink.canvases()) {
      throwIfCancelled();

      const detected = timeline.regionsAt(wrapped.timestamp, windowSec, settings.padding);
      const regions =
        paddedManual.length > 0 ? mergeOverlapping([...detected, ...paddedManual]) : detected;

      renderRedacted(ctx, wrapped.canvas, regions, outWidth, outHeight, settings);
      await videoSource.add(wrapped.timestamp, wrapped.duration);

      frames++;
      if (frames % 5 === 0) {
        progress('render', wrapped.timestamp / duration, `frame ${frames}`);
      }
    }
    videoSource.close();
    return frames;
  };

  const copyAudio = async () => {
    if (!audioTrack || !audioSource) return;
    const packetSink = new EncodedPacketSink(audioTrack);
    const decoderConfig = await audioTrack.getDecoderConfig();
    let first = true;
    for await (const packet of packetSink.packets()) {
      throwIfCancelled();
      await audioSource.add(packet, first && decoderConfig ? { decoderConfig } : undefined);
      first = false;
    }
    audioSource.close();
  };

  const [framesProcessed] = await Promise.all([renderFrames(), copyAudio()]);

  progress('render', 1);
  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Encoding finished but produced no data.');
  // Copy into a fresh ArrayBuffer: the target's buffer is ArrayBufferLike under
  // TS strict, which Blob's typings reject.
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(new Uint8Array(buffer));

  post({
    type: 'video-done',
    blob: new Blob([bytes], { type: 'video/mp4' }),
    framesProcessed,
    facesFound: timeline.detectionCount,
  });
}

// ────────────────────────────────────────────────────────── dispatch ──

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'cancel') {
    cancelled = true;
    return;
  }

  cancelled = false;

  try {
    switch (request.type) {
      case 'probe':
        post({ type: 'probed', info: await probe(request.file) });
        break;
      case 'detect-frame':
        await detectInFrame(request.bitmap, request.minConfidence);
        break;
      case 'render-image':
        await renderImage(request.file, request.boxes, request.settings, request.mimeType);
        break;
      case 'render-video':
        await renderVideo(request.file, request.manual, request.settings);
        break;
    }
  } catch (error) {
    if (error instanceof CancelledError || cancelled) {
      post({ type: 'cancelled' });
      return;
    }
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'Something went wrong.',
    });
  }
};

self.addEventListener('close', () => closeDetector());
