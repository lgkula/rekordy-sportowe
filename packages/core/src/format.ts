/**
 * Display formatting helpers (Polish conventions).
 * Pure functions without Node- or DOM-specific APIs, so they run in the browser and in Node.
 */

const PLACEHOLDER = '—';

function isValidNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Pace in seconds per kilometre for a given duration and distance. */
export function paceSecondsPerKm(durationS: number, distanceM: number): number {
  if (!isValidNumber(durationS) || !(distanceM > 0)) {
    throw new RangeError('Duration must be >= 0 and distance must be > 0');
  }
  return durationS / (distanceM / 1000);
}

/**
 * Formats a pace as `m:ss` (e.g. `4:35`), optionally with the ` /km` unit.
 * Rounds to the nearest second.
 */
export function formatPace(secondsPerKm: number, options: { unit?: boolean } = {}): string {
  if (!isValidNumber(secondsPerKm)) return PLACEHOLDER;
  const total = Math.round(secondsPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const text = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return options.unit ? `${text} /km` : text;
}

/**
 * Formats a duration: `h:mm:ss` from one hour up, `m:ss` below (e.g. `19:45`, `1:32:10`).
 * Rounds to the nearest second.
 */
export function formatDuration(totalSeconds: number): string {
  if (!isValidNumber(totalSeconds)) return PLACEHOLDER;
  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

const distanceFormatters = new Map<number, Intl.NumberFormat>();

function distanceFormatter(decimals: number): Intl.NumberFormat {
  let formatter = distanceFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    });
    distanceFormatters.set(decimals, formatter);
  }
  return formatter;
}

/** Formats a distance in metres as kilometres with a Polish decimal comma, e.g. `21,10 km`. */
export function formatDistance(
  distanceM: number,
  options: { decimals?: number; unit?: boolean } = {},
): string {
  if (!isValidNumber(distanceM)) return PLACEHOLDER;
  const { decimals = 2, unit = true } = options;
  const text = distanceFormatter(decimals).format(distanceM / 1000);
  return unit ? `${text} km` : text;
}

/** Formats a `YYYY-MM-DD` date as `dd.MM.yyyy` (e.g. `12.09.2026`). */
export function formatLocalDate(localDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : PLACEHOLDER;
}
