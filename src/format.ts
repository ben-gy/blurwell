/** Small pure formatters shared by the UI and the event log. */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "3 faces" / "1 face" / "no faces" */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  if (count === 0) return `no ${plural}`;
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Swaps a filename's extension and tags it as anonymised, so the export never
 * silently overwrites the original in the Downloads folder.
 */
export function outputFilename(original: string, extension: string): string {
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `${stem}-blurred.${extension}`;
}
