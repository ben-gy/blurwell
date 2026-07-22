// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * The preview stage.
 *
 * The canvas shows a live, fully-rendered preview using the *same* redaction
 * code the export uses, so what you see really is what gets written. Boxes are
 * separate DOM elements on top for hit-testing — dragging adds one, clicking
 * removes one.
 */

import { boxContains, boxFromPoints, mergeOverlapping, padBox } from './geometry';
import { renderRedacted } from './redact';
import type { Box, Detection, Settings } from './types';

const MIN_BOX_FRACTION = 0.01;

export class BoxEditor {
  private stage: HTMLElement;
  private canvas: HTMLCanvasElement;
  private layer: HTMLElement;
  private ctx: CanvasRenderingContext2D;

  private source: ImageBitmap | null = null;
  private detected: Box[] = [];
  private manual: Box[] = [];
  private settings: Settings | null = null;

  private dragStart: { x: number; y: number } | null = null;
  private dragGhost: HTMLElement | null = null;

  /** Fired whenever the set of boxes changes, so the UI can update counts. */
  onChange: (() => void) | null = null;

  constructor(stage: HTMLElement, canvas: HTMLCanvasElement, layer: HTMLElement) {
    this.stage = stage;
    this.canvas = canvas;
    this.layer = layer;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing context.');
    this.ctx = ctx;

    this.bindPointer();
  }

  // ─────────────────────────────────────────────────────────── state ──

  setSource(bitmap: ImageBitmap): void {
    this.source?.close();
    this.source = bitmap;
    this.canvas.width = bitmap.width;
    this.canvas.height = bitmap.height;
    this.stage.style.aspectRatio = `${bitmap.width} / ${bitmap.height}`;
    this.redraw();
  }

  setDetections(detections: Detection[]): void {
    this.detected = detections.map((d) => d.box);
    this.redraw();
    this.onChange?.();
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.redraw();
  }

  /** Boxes the user drew by hand — these apply to a whole video, not one frame. */
  get manualBoxes(): Box[] {
    return [...this.manual];
  }

  /** Everything to redact in a still image: detections plus manual boxes. */
  get allBoxes(): Box[] {
    return [...this.detected, ...this.manual];
  }

  get detectedCount(): number {
    return this.detected.length;
  }

  get manualCount(): number {
    return this.manual.length;
  }

  clear(): void {
    this.detected = [];
    this.manual = [];
    this.source?.close();
    this.source = null;
    this.layer.replaceChildren();
    this.onChange?.();
  }

  // ────────────────────────────────────────────────────────── render ──

  redraw(): void {
    if (!this.source || !this.settings) return;

    const boxes = mergeOverlapping(
      this.allBoxes.map((b) => padBox(b, this.settings!.padding)),
    );
    renderRedacted(
      this.ctx,
      this.source,
      boxes,
      this.canvas.width,
      this.canvas.height,
      this.settings,
    );
    this.renderHandles();
  }

  private renderHandles(): void {
    this.layer.replaceChildren();

    const add = (box: Box, kind: 'detected' | 'manual', index: number) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `box-handle is-${kind}`;
      el.style.left = `${box.x * 100}%`;
      el.style.top = `${box.y * 100}%`;
      el.style.width = `${box.w * 100}%`;
      el.style.height = `${box.h * 100}%`;
      el.dataset.kind = kind;
      el.dataset.index = String(index);
      el.title = kind === 'detected' ? 'Detected face — click to remove' : 'Click to remove';
      el.setAttribute(
        'aria-label',
        kind === 'detected' ? 'Detected face, click to remove' : 'Manual box, click to remove',
      );
      this.layer.append(el);
    };

    this.detected.forEach((box, i) => add(box, 'detected', i));
    this.manual.forEach((box, i) => add(box, 'manual', i));
  }

  // ───────────────────────────────────────────────────────── pointer ──

  /** Converts a pointer event to normalised stage coordinates. */
  private toNormalised(event: PointerEvent): { x: number; y: number } {
    const rect = this.layer.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  private bindPointer(): void {
    this.layer.addEventListener('pointerdown', (event) => {
      if (!this.source) return;

      const point = this.toNormalised(event);

      // Clicking an existing box removes it — deleting a false positive should
      // not require finding a separate control.
      const handle = (event.target as HTMLElement).closest<HTMLElement>('.box-handle');
      if (handle) {
        const index = Number(handle.dataset.index);
        if (handle.dataset.kind === 'detected') this.detected.splice(index, 1);
        else this.manual.splice(index, 1);
        this.redraw();
        this.onChange?.();
        return;
      }

      // Otherwise start dragging a new box.
      this.dragStart = point;
      this.layer.setPointerCapture(event.pointerId);

      this.dragGhost = document.createElement('div');
      this.dragGhost.className = 'box-ghost';
      this.layer.append(this.dragGhost);
      event.preventDefault();
    });

    this.layer.addEventListener('pointermove', (event) => {
      if (!this.dragStart || !this.dragGhost) return;
      const point = this.toNormalised(event);
      const box = boxFromPoints(this.dragStart.x, this.dragStart.y, point.x, point.y, 1, 1);
      this.dragGhost.style.left = `${box.x * 100}%`;
      this.dragGhost.style.top = `${box.y * 100}%`;
      this.dragGhost.style.width = `${box.w * 100}%`;
      this.dragGhost.style.height = `${box.h * 100}%`;
    });

    const finish = (event: PointerEvent) => {
      if (!this.dragStart) return;
      const point = this.toNormalised(event);
      const box = boxFromPoints(this.dragStart.x, this.dragStart.y, point.x, point.y, 1, 1);

      this.dragGhost?.remove();
      this.dragGhost = null;
      this.dragStart = null;

      // Ignore accidental taps — they'd litter the frame with invisible boxes.
      if (box.w > MIN_BOX_FRACTION && box.h > MIN_BOX_FRACTION) {
        this.manual.push(box);
        this.redraw();
        this.onChange?.();
      }
    };

    this.layer.addEventListener('pointerup', finish);
    this.layer.addEventListener('pointercancel', finish);
  }

  /** Removes the topmost box under a normalised point, if any. Used by tests. */
  removeAt(px: number, py: number): boolean {
    for (let i = this.manual.length - 1; i >= 0; i--) {
      if (boxContains(this.manual[i], px, py)) {
        this.manual.splice(i, 1);
        this.redraw();
        this.onChange?.();
        return true;
      }
    }
    for (let i = this.detected.length - 1; i >= 0; i--) {
      if (boxContains(this.detected[i], px, py)) {
        this.detected.splice(i, 1);
        this.redraw();
        this.onChange?.();
        return true;
      }
    }
    return false;
  }
}
