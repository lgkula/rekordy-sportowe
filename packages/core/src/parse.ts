/**
 * Parsing of form input written the Polish way: times as `mm:ss` / `h:mm:ss`, decimals with
 * a comma (a dot is accepted too). Parsers return null for invalid input.
 */

const DURATION_RE = /^(?:(\d+):([0-5]\d)|(\d+)):([0-5]\d)(?:[.,](\d))?$/;

/**
 * Parses a duration: `mm:ss` (minutes may exceed 59, e.g. `75:30`) or `h:mm:ss`, with an
 * optional tenth of a second (`19:45,3`). Returns seconds, or null.
 */
export function parseDuration(input: string): number | null {
  const match = DURATION_RE.exec(input.trim());
  if (!match) return null;
  const [, hours, minutesWithHours, minutesOnly, seconds, tenths] = match;
  const h = hours === undefined ? 0 : Number(hours);
  const m = Number(minutesWithHours ?? minutesOnly);
  const total = h * 3600 + m * 60 + Number(seconds) + (tenths ? Number(tenths) / 10 : 0);
  return total > 0 ? total : null;
}

const DECIMAL_RE = /^\d+(?:[.,]\d+)?$/;

/** Parses a non-negative decimal number written with a comma or a dot (`5,3`, `5.3`, `12`). */
export function parseDecimal(input: string): number | null {
  const text = input.trim().replace(/\s+/g, '');
  if (!DECIMAL_RE.test(text)) return null;
  return Number(text.replace(',', '.'));
}

/** Parses a distance in kilometres (`21,0975`, `5.3 km`) and returns metres (0.1 m precision). */
export function parseDistanceKm(input: string): number | null {
  const km = parseDecimal(input.trim().replace(/\s*km$/i, ''));
  if (km === null || km <= 0) return null;
  return Math.round(km * 10_000) / 10;
}

/** Formats seconds for a form input (`19:45`, `1:32:10`, `19:45,3`): the inverse of parseDuration. */
export function formatDurationInput(totalSeconds: number): string {
  const tenthsTotal = Math.round(totalSeconds * 10);
  const whole = Math.floor(tenthsTotal / 10);
  const tenths = tenthsTotal % 10;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  const base =
    hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  return tenths ? `${base},${tenths}` : base;
}

/** Formats metres as kilometres for a form input, with a comma and no trailing zeros (`21,0975`). */
export function formatDistanceInput(distanceM: number): string {
  const km = Math.round(distanceM * 10) / 10_000;
  return String(km).replace('.', ',');
}
