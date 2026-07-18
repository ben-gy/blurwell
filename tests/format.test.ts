import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatTimestamp,
  outputFilename,
  pluralise,
} from '../src/format';

describe('formatBytes', () => {
  it('shows raw bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('scales through the units', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('drops the decimal once the value reaches double digits', () => {
    expect(formatBytes(1024 * 15)).toBe('15 KB');
  });

  it('handles nonsense input without throwing', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats under a minute', () => {
    expect(formatDuration(5)).toBe('0:05');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2:05');
  });

  it('adds an hours field only when needed', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(59)).toBe('0:59');
  });

  it('handles zero and invalid input', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });
});

describe('formatTimestamp', () => {
  it('zero-pads to HH:MM:SS', () => {
    expect(formatTimestamp(new Date(2026, 6, 18, 9, 4, 3))).toBe('09:04:03');
  });
});

describe('pluralise', () => {
  it('handles zero, one and many', () => {
    expect(pluralise(0, 'face')).toBe('no faces');
    expect(pluralise(1, 'face')).toBe('1 face');
    expect(pluralise(3, 'face')).toBe('3 faces');
  });

  it('accepts an irregular plural', () => {
    expect(pluralise(2, 'manual box', 'manual boxes')).toBe('2 manual boxes');
    expect(pluralise(0, 'manual box', 'manual boxes')).toBe('no manual boxes');
  });
});

describe('outputFilename', () => {
  it('swaps the extension and tags the file', () => {
    expect(outputFilename('holiday.jpg', 'jpg')).toBe('holiday-blurred.jpg');
  });

  it('changes the extension when the format changes', () => {
    expect(outputFilename('clip.mov', 'mp4')).toBe('clip-blurred.mp4');
  });

  it('handles a name with several dots', () => {
    expect(outputFilename('my.holiday.photo.png', 'png')).toBe('my.holiday.photo-blurred.png');
  });

  it('handles a name with no extension', () => {
    expect(outputFilename('scan', 'jpg')).toBe('scan-blurred.jpg');
  });

  it('does not treat a leading dot as an extension', () => {
    expect(outputFilename('.hidden', 'jpg')).toBe('.hidden-blurred.jpg');
  });

  it('never returns the original name — the export must not overwrite the source', () => {
    for (const name of ['a.jpg', 'b.png', 'c.mp4', 'no-ext']) {
      expect(outputFilename(name, 'jpg')).not.toBe(name);
    }
  });
});
