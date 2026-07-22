// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/** DOM plumbing: modals, the drop zone, and the progress/result panels. */

export function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

// ──────────────────────────────────────────────────────────── modals ──

let openModal: HTMLElement | null = null;

function buildModal(templateId: string): HTMLElement {
  const template = document.getElementById(templateId) as HTMLTemplateElement | null;
  if (!template) throw new Error(`Missing template #${templateId}`);

  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'modal-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', () => closeModal());

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.append(template.content.cloneNode(true));

  dialog.append(close, body);
  return dialog;
}

export function closeModal(): void {
  openModal?.remove();
  openModal = null;
  must('modal-backdrop').hidden = true;
  document.body.classList.remove('modal-open');
}

export function showModal(name: string): void {
  closeModal();
  const dialog = buildModal(`modal-${name}`);
  const backdrop = must('modal-backdrop');
  backdrop.hidden = false;
  document.body.append(dialog);
  document.body.classList.add('modal-open');
  openModal = dialog;
  (dialog.querySelector('.modal-close') as HTMLElement | null)?.focus();
}

export function initModals(): void {
  document.addEventListener('click', (event) => {
    const trigger = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-modal]');
    if (trigger?.dataset.modal) {
      event.preventDefault();
      showModal(trigger.dataset.modal);
    }
  });

  must('modal-backdrop').addEventListener('click', () => closeModal());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openModal) closeModal();
  });
}

// ───────────────────────────────────────────────────────── drop zone ──

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|bmp|avif)$/;

export function isSupportedFile(file: File): boolean {
  return IMAGE_TYPES.test(file.type) || file.type.startsWith('video/');
}

/**
 * Wires drag-and-drop, click-to-pick and paste-to-ingest onto the drop zone.
 * Returns a teardown function so the paste listener doesn't outlive the page.
 */
export function initDropzone(onFile: (file: File) => void): () => void {
  const zone = must('dropzone');
  const input = must<HTMLInputElement>('file-input');

  const pick = () => input.click();
  zone.addEventListener('click', pick);
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick();
    }
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
    // Reset so picking the same file twice still fires a change event.
    input.value = '';
  });

  const stop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  zone.addEventListener('dragover', (event) => {
    stop(event);
    zone.classList.add('is-dragging');
  });
  zone.addEventListener('dragleave', (event) => {
    stop(event);
    zone.classList.remove('is-dragging');
  });
  zone.addEventListener('drop', (event) => {
    stop(event);
    zone.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });

  // Dropping anywhere else on the page shouldn't navigate away from the app.
  const blockNavigation = (event: DragEvent) => event.preventDefault();
  window.addEventListener('dragover', blockNavigation);
  window.addEventListener('drop', blockNavigation);

  const onPaste = (event: ClipboardEvent) => {
    const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
      i.type.startsWith('image/'),
    );
    const file = item?.getAsFile();
    if (file) onFile(file);
  };
  document.addEventListener('paste', onPaste);

  return () => {
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('dragover', blockNavigation);
    window.removeEventListener('drop', blockNavigation);
  };
}

// ──────────────────────────────────────────────────── panel switching ──

export type Panel = 'intake' | 'editor' | 'progress' | 'result';

export function showPanel(panel: Panel): void {
  must('intake').hidden = panel !== 'intake';
  must('editor').hidden = panel !== 'editor';
  must('progress-panel').hidden = panel !== 'progress';
  must('result-panel').hidden = panel !== 'result';
}

export function setProgress(phase: string, ratio: number, detail?: string): void {
  must('progress-phase').textContent = phase;
  must('progress-fill').style.width = `${Math.round(ratio * 100)}%`;
  must('progress-detail').textContent = detail ?? `${Math.round(ratio * 100)}%`;
}

export function showError(message: string): void {
  const banner = must('error-banner');
  must('error-message').textContent = message;
  banner.hidden = false;
}

export function clearError(): void {
  must('error-banner').hidden = true;
}
