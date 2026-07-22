// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Click-to-define tooltips. The audience for this tool includes people who are
 * anxious rather than technical, so any jargon the UI uses has to be one tap
 * from a plain-English definition.
 */

export const GLOSSARY: Record<string, string> = {
  'on-device':
    'The work happens inside this browser tab, using your own processor. No copy of your file is sent anywhere — you can disconnect from the internet and the tool still works.',
  blazeface:
    'A small neural network (about 224 KB) that finds the location of faces in an image. It reports rectangles only — it never works out who anyone is.',
  webcodecs:
    "A browser feature that gives web pages direct access to your device's video decoder and encoder — the same hardware your media player uses. It's what makes re-encoding a video in a tab fast enough to be practical.",
  persistence:
    'How long a detected face stays covered after the detector last saw it. Detectors miss a frame here and there; holding each box for a fraction of a second means a brief miss stays hidden instead of flashing an unblurred face.',
  padding:
    "How far each blur box is grown beyond the detected face. The detector returns a tight crop around the eyes, nose and mouth; padding makes sure hair, chin and ears are covered too, since those identify someone as well.",
  'burned in':
    'The blur is written into the actual pixels of the exported file, not drawn as a layer on top. There is nothing to peel away — the original detail is gone from the export.',
  pixelate:
    'Replaces a region with large blocks of solid colour. At low strength this can sometimes be partially reversed by software, which is why Blurwell defaults to a heavy blur instead.',
  exif:
    'Hidden data cameras attach to photos — GPS coordinates, date, device serial number. Blurwell rebuilds the image from pixels alone, so none of it survives into the export.',
  'h.264':
    'The most widely supported video format, playable on essentially every phone, browser and editor. Blurwell exports MP4 files using it.',
};

let tooltip: HTMLElement | null = null;

function ensureTooltip(): HTMLElement {
  if (tooltip) return tooltip;
  tooltip = document.createElement('div');
  tooltip.className = 'glossary-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  return tooltip;
}

function hide(): void {
  if (tooltip) tooltip.hidden = true;
}

function show(target: HTMLElement, term: string): void {
  const definition = GLOSSARY[term];
  if (!definition) return;

  const el = ensureTooltip();
  el.textContent = definition;
  el.hidden = false;

  const rect = target.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 32);
  el.style.width = `${width}px`;

  const left = Math.min(Math.max(rect.left, 16), window.innerWidth - width - 16);
  el.style.left = `${left}px`;

  // Flip above the term if there isn't room below it.
  const below = rect.bottom + 8;
  if (below + el.offsetHeight > window.innerHeight - 16) {
    el.style.top = `${Math.max(16, rect.top - el.offsetHeight - 8)}px`;
  } else {
    el.style.top = `${below}px`;
  }
}

/** Wires every `.glossary-link[data-term]` in the document. */
export function initGlossary(): void {
  document.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.glossary-link');
    if (!target) {
      hide();
      return;
    }
    event.preventDefault();
    const term = target.dataset.term;
    if (!term) return;

    if (!tooltip?.hidden && tooltip?.dataset.term === term) {
      hide();
      return;
    }
    show(target, term);
    if (tooltip) tooltip.dataset.term = term;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', hide, true);
}
