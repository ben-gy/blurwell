// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Bootstraps the app and owns the conversation with the worker. Deliberately
 * thin: no image maths lives here, only wiring.
 */

// feedback:begin (managed by hub/scripts/feedback/backfill.mjs)
import { mountFeedback } from './feedback';
mountFeedback();
// feedback:end

import './styles/main.css';

import { BoxEditor } from './boxeditor';
import { EventLog } from './eventlog';
import { formatBytes, formatDuration, outputFilename, pluralise } from './format';
import { initGlossary } from './glossary';
import {
  clearError,
  initDropzone,
  initModals,
  isSupportedFile,
  must,
  setProgress,
  showError,
  showPanel,
} from './ui';
import { DEFAULT_SETTINGS } from './types';
import type { Settings, SourceInfo, WorkerRequest, WorkerResponse } from './types';

const PREFS_KEY = 'blurwell:settings';

let worker: Worker | null = null;
let editor: BoxEditor;
let log: EventLog;

let currentFile: File | null = null;
let currentInfo: SourceInfo | null = null;
let resultBlob: Blob | null = null;
let resultName = 'blurred';
let settings: Settings = { ...DEFAULT_SETTINGS };

// ───────────────────────────────────────────────────────── settings ──

function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<Settings>;
    settings = { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    // A corrupt preference blob must never stop the tool from loading.
    settings = { ...DEFAULT_SETTINGS };
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(settings));
  } catch {
    // Private-mode storage quota — preferences simply don't persist.
  }
}

// ─────────────────────────────────────────────────────────── worker ──

function getWorker(): Worker {
  if (worker) return worker;
  // Classic worker, not a module one — see the `worker.format` note in
  // vite.config.ts: MediaPipe's WASM loader needs importScripts().
  worker = new Worker(new URL('./worker.ts', import.meta.url));
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => handleWorkerMessage(event.data);
  worker.onerror = (event) => {
    showError(event.message || 'The processing worker failed to start.');
    log.add('bad', `Worker error: ${event.message}`);
    showPanel(currentInfo ? 'editor' : 'intake');
  };
  return worker;
}

function send(request: WorkerRequest, transfer: Transferable[] = []): void {
  getWorker().postMessage(request, transfer);
}

function handleWorkerMessage(message: WorkerResponse): void {
  switch (message.type) {
    case 'log':
      log.add(message.level, message.message);
      break;

    case 'progress': {
      const labels: Record<string, string> = {
        detect: 'Looking for faces…',
        scan: 'Pass 1 of 2 — scanning for faces…',
        render: currentInfo?.kind === 'video' ? 'Pass 2 of 2 — redacting and encoding…' : 'Redacting…',
      };
      setProgress(labels[message.phase] ?? 'Working…', message.ratio, message.detail);
      break;
    }

    case 'detected':
      editor.setSource(message.bitmap);
      editor.setDetections(message.detections);
      showPanel('editor');
      break;

    case 'image-done':
      finishResult(message.blob, 'image');
      break;

    case 'video-done':
      log.add(
        'good',
        `Encoded ${message.framesProcessed} frames covering ${pluralise(message.facesFound, 'face sighting')}.`,
      );
      finishResult(message.blob, 'video');
      break;

    case 'error':
      showError(message.message);
      log.add('bad', message.message);
      showPanel(currentInfo ? 'editor' : 'intake');
      break;

    case 'cancelled':
      log.add('warn', 'Cancelled.');
      showPanel('editor');
      break;

    case 'probed': {
      // Arrives after the preview is already on screen; fills in the details
      // only a full demux can tell us (duration, frame rate, audio track).
      currentInfo = { ...message.info };
      const info = message.info;
      const bits = [
        'Video',
        `${info.width}×${info.height}`,
        formatDuration(info.duration ?? 0),
        formatBytes(info.size),
        info.hasAudio ? `audio: ${info.audioCodec ?? 'unknown'}` : 'no audio',
      ];
      must('file-meta').textContent = bits.join(' · ');
      log.add(
        'info',
        `${formatDuration(info.duration ?? 0)} of video at ~${Math.round(info.frameRate ?? 30)} fps.`,
      );
      break;
    }
  }
}

// ───────────────────────────────────────────────────── file loading ──

/** Grabs a still from a video so the editor has something to show and detect on. */
async function firstFrame(file: File): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new Error('This video format cannot be previewed here.'));
      video.addEventListener('error', fail, { once: true });
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      // Some containers only decode a frame once a seek completes.
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
      }, { once: true });
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing context.');
    ctx.drawImage(video, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function loadFile(file: File): Promise<void> {
  if (!isSupportedFile(file)) {
    showError('That file type isn’t supported. Choose a JPG, PNG, WebP, MP4, MOV or WebM.');
    return;
  }

  clearError();
  currentFile = file;
  resultBlob = null;

  const kind: SourceInfo['kind'] = file.type.startsWith('video/') ? 'video' : 'image';
  log.add('info', `Opened ${file.name} (${formatBytes(file.size)}) — locally, in this tab.`);

  showPanel('progress');
  setProgress('Opening file…', 0.05);

  try {
    const bitmap =
      kind === 'video' ? await firstFrame(file) : await createImageBitmap(file);

    currentInfo = {
      kind,
      name: file.name,
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
    };

    // For video we still need duration/audio details; the worker probes while
    // the user looks at the first frame.
    if (kind === 'video') send({ type: 'probe', file });

    must('video-only-controls').hidden = kind !== 'video';
    must('file-name').textContent = file.name;
    must('file-meta').textContent =
      `${kind === 'video' ? 'Video' : 'Image'} · ${bitmap.width}×${bitmap.height} · ${formatBytes(file.size)}`;
    must('stage-hint').textContent =
      kind === 'video'
        ? 'Drag to add a box (applies to the whole clip) · click a box to remove it'
        : 'Drag on the image to add a box · click a box to remove it';

    setProgress('Looking for faces…', 0.2);
    send({ type: 'detect-frame', bitmap, minConfidence: settings.minConfidence }, [bitmap]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not open that file.';
    showError(message);
    log.add('bad', message);
    showPanel('intake');
  }
}

// ────────────────────────────────────────────────────────── results ──

function outputMime(file: File): string {
  if (file.type === 'image/png') return 'image/png';
  if (file.type === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

function outputExtension(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function finishResult(blob: Blob, kind: 'image' | 'video'): void {
  resultBlob = blob;
  const extension = kind === 'video' ? 'mp4' : outputExtension(blob.type || 'image/jpeg');
  resultName = outputFilename(currentFile?.name ?? 'file', extension);

  must('result-meta').textContent = `${resultName} · ${formatBytes(blob.size)}`;
  log.add('good', `Ready: ${resultName} (${formatBytes(blob.size)}).`);

  // Web Share only accepts files on platforms that support it — usually mobile.
  const shareButton = must<HTMLButtonElement>('share');
  const file = new File([blob], resultName, { type: blob.type });
  shareButton.hidden = !(navigator.canShare?.({ files: [file] }) ?? false);

  // Copy-to-clipboard is image-only; browsers reject video in ClipboardItem.
  must<HTMLButtonElement>('copy').hidden = kind !== 'image' || !navigator.clipboard?.write;

  showPanel('result');
}

function download(): void {
  if (!resultBlob) return;
  const url = URL.createObjectURL(resultBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = resultName;
  anchor.click();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  log.add('info', 'Saved to your downloads.');
}

async function share(): Promise<void> {
  if (!resultBlob) return;
  const file = new File([resultBlob], resultName, { type: resultBlob.type });
  try {
    await navigator.share({ files: [file], title: resultName });
    log.add('info', 'Handed to the system share sheet.');
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return;
    showError('Sharing failed — use Download instead.');
  }
}

async function copyImage(): Promise<void> {
  if (!resultBlob) return;
  try {
    // Safari rejects JPEG in ClipboardItem, so normalise to PNG first.
    const bitmap = await createImageBitmap(resultBlob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Could not prepare the image.');

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    log.add('good', 'Copied to the clipboard.');
  } catch {
    showError('Copying failed — use Download instead.');
  }
}

// ────────────────────────────────────────────────────────── actions ──

function run(): void {
  if (!currentFile || !currentInfo) return;
  clearError();
  showPanel('progress');
  setProgress('Starting…', 0.02);

  if (currentInfo.kind === 'image') {
    log.add('info', `Redacting ${pluralise(editor.allBoxes.length, 'region')}.`);
    send({
      type: 'render-image',
      file: currentFile,
      boxes: editor.allBoxes,
      settings,
      mimeType: outputMime(currentFile),
    });
  } else {
    log.add('info', 'Starting two-pass video redaction.');
    send({ type: 'render-video', file: currentFile, manual: editor.manualBoxes, settings });
  }
}

function redetect(): void {
  if (!currentFile) return;
  showPanel('progress');
  setProgress('Looking for faces…', 0.2);
  (currentInfo?.kind === 'video' ? firstFrame(currentFile) : createImageBitmap(currentFile))
    .then((bitmap) =>
      send({ type: 'detect-frame', bitmap, minConfidence: settings.minConfidence }, [bitmap]),
    )
    .catch(() => {
      showError('Could not re-read the file.');
      showPanel('editor');
    });
}

function reset(): void {
  currentFile = null;
  currentInfo = null;
  resultBlob = null;
  editor.clear();
  clearError();
  showPanel('intake');
}

function updateDetectSummary(): void {
  const detected = editor.detectedCount;
  const manual = editor.manualCount;
  const parts = [`${pluralise(detected, 'face')} detected`];
  if (manual > 0) parts.push(`${pluralise(manual, 'manual box', 'manual boxes')}`);
  must('detect-summary').textContent = parts.join(' · ');
}

// ───────────────────────────────────────────────────────────── init ──

function bindControls(): void {
  const strength = must<HTMLInputElement>('strength');
  const padding = must<HTMLInputElement>('padding');
  const persistence = must<HTMLInputElement>('persistence');
  const removeAudio = must<HTMLInputElement>('remove-audio');

  strength.value = String(Math.round(settings.strength * 100));
  padding.value = String(Math.round(settings.padding * 100));
  persistence.value = String(settings.persistenceMs);
  removeAudio.checked = settings.removeAudio;

  const sync = () => {
    must('strength-value').textContent = `${strength.value}%`;
    must('padding-value').textContent = `${padding.value}%`;
    must('persistence-value').textContent = `${persistence.value} ms`;
    editor.setSettings(settings);
    savePrefs();
  };

  strength.addEventListener('input', () => {
    settings.strength = Number(strength.value) / 100;
    sync();
  });
  padding.addEventListener('input', () => {
    settings.padding = Number(padding.value) / 100;
    sync();
  });
  persistence.addEventListener('input', () => {
    settings.persistenceMs = Number(persistence.value);
    sync();
  });
  removeAudio.addEventListener('change', () => {
    settings.removeAudio = removeAudio.checked;
    savePrefs();
  });

  must('style-group').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-style]');
    if (!button?.dataset.style) return;
    settings.style = button.dataset.style as Settings['style'];
    for (const option of must('style-group').querySelectorAll('[data-style]')) {
      option.setAttribute('aria-checked', String(option === button));
    }
    sync();
  });

  for (const option of must('style-group').querySelectorAll<HTMLElement>('[data-style]')) {
    option.setAttribute('aria-checked', String(option.dataset.style === settings.style));
  }

  sync();
}

function bindActions(): void {
  must('run').addEventListener('click', run);
  must('redetect').addEventListener('click', redetect);
  must('reset').addEventListener('click', reset);
  must('again').addEventListener('click', reset);
  must('download').addEventListener('click', download);
  must('share').addEventListener('click', () => void share());
  must('copy').addEventListener('click', () => void copyImage());
  must('error-retry').addEventListener('click', () => {
    clearError();
    showPanel(currentInfo ? 'editor' : 'intake');
  });
  must('cancel').addEventListener('click', () => {
    send({ type: 'cancel' });
    log.add('warn', 'Cancelling…');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
    if (!must('editor').hidden) run();
  });
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || location.protocol === 'http:') return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Offline support is a bonus; failing to register must not break the tool.
  });
}

function init(): void {
  loadPrefs();
  initModals();
  initGlossary();

  log = new EventLog(must('eventlog'), must<HTMLButtonElement>('eventlog-toggle'));
  editor = new BoxEditor(
    must('stage'),
    must<HTMLCanvasElement>('preview-canvas'),
    must('box-layer'),
  );
  editor.onChange = updateDetectSummary;
  editor.setSettings(settings);

  bindControls();
  bindActions();
  initDropzone((file) => void loadFile(file));

  log.add('info', 'Blurwell ready — everything below happens on your device.');
  showPanel('intake');
  registerServiceWorker();
}

init();
