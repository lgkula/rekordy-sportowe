/**
 * Event name matching (PLAN.md 4.3): when a race is saved, existing events with a similar
 * name are suggested. Names are compared as sets of normalised tokens, so that
 * "XV Bieg Niepodległości 2024" and "Bieg Niepodleglosci" match:
 * - lowercase, Polish letters folded to ASCII (ł → l, ś → s, …);
 * - dates, years, ordinals ("15.", "XV") and bare numbers are dropped, distances ("10 km")
 *   are kept as one token ("10km");
 * - edition words ("edycja") and filler words are dropped; generic words ("bieg") only
 *   when something more specific is left.
 */

const POLISH_LETTERS: Readonly<Record<string, string>> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/** Lowercase text without Polish (or other) diacritics, e.g. for substring search. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => POLISH_LETTERS[c] ?? c)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Words that name the edition, not the race. */
const EDITION_WORDS = new Set([
  'edycja',
  'edycji',
  'edycje',
  'edition',
  'ed',
  'jubileuszowy',
  'jubileuszowa',
  'jubileuszowe',
  'jubileuszowego',
]);

/** Conjunctions, prepositions and ordinal suffixes ("15-ty"). */
const FILLER_WORDS = new Set([
  'i',
  'w',
  'we',
  'na',
  'z',
  'ze',
  'o',
  'do',
  'po',
  'im',
  'of',
  'the',
  'and',
  'ty',
  'ta',
  'te',
  'go',
  'th',
  'st',
  'nd',
  'rd',
]);

/** Words in almost every race name: they count only when nothing else is left. */
const GENERIC_WORDS = new Set(['bieg', 'biegu', 'biegi', 'run', 'race', 'zawody']);

const ROMAN_NUMERAL = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

/**
 * Roman numerals written in capitals ("XV", "I"), or in lowercase when they contain only
 * i/v/x and have two letters or more ("xv"), so that words like "mix" are not dropped.
 */
function isRomanNumeral(raw: string): boolean {
  const lower = raw.toLowerCase();
  if (lower === '' || !ROMAN_NUMERAL.test(lower)) return false;
  if (raw === raw.toUpperCase()) return true;
  return lower.length >= 2 && /^[ivx]+$/.test(lower);
}

/** Normalised tokens of an event (or activity) name; see the module comment. */
export function eventNameTokens(name: string): string[] {
  const text = name
    // Dates: 27.09.2026, 27-09-26, 2026-09-27.
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ')
    // Distances stay, as one token: "10 km" → "10km", "21,1km" → "21.1km".
    .replace(
      /(\d+)(?:[.,](\d+))?\s*(km|k)\b/gi,
      (_m, whole: string, fraction?: string) => ` ${whole}${fraction ? `.${fraction}` : ''}km `,
    )
    // Ordinals with a dot: "15. Bieg".
    .replace(/\b\d{1,3}\.(?=\s|$)/g, ' ');

  const tokens: string[] = [];
  for (const raw of text.split(/[^\p{L}\p{N}.]+/u)) {
    const trimmed = raw.replace(/^\.+|\.+$/g, '');
    if (trimmed === '' || isRomanNumeral(trimmed)) continue;
    const token = foldText(trimmed);
    if (/^\d+$/.test(token) || EDITION_WORDS.has(token) || FILLER_WORDS.has(token)) continue;
    tokens.push(token);
  }
  const specific = tokens.filter((t) => !GENERIC_WORDS.has(t));
  return [...new Set(specific.length > 0 ? specific : tokens)];
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** A shared stem (Polish inflection: "opolski" / "opolska") counts from this many letters. */
const MIN_STEM = 4;
const MIN_STEM_RATIO = 0.7;
/** Typos: at most one edit per five letters. */
const MIN_EDIT_RATIO = 0.8;

/** Similarity of two tokens in [0, 1]; 0 when they do not match at all. */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLength = Math.max(a.length, b.length);
  const prefix = commonPrefixLength(a, b);
  const byStem = prefix >= MIN_STEM ? prefix / maxLength : 0;
  const byEdits = 1 - levenshtein(a, b) / maxLength;
  const best = Math.max(
    byStem >= MIN_STEM_RATIO ? byStem : 0,
    byEdits >= MIN_EDIT_RATIO ? byEdits : 0,
  );
  return best;
}

/**
 * Similarity of two names in [0, 1]: every token is paired with its best match on the other
 * side, in both directions, so extra words lower the score.
 */
export function eventNameSimilarity(a: string, b: string): number {
  const ta = eventNameTokens(a);
  const tb = eventNameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const matched = (from: string[], to: string[]) =>
    from.reduce((sum, x) => sum + Math.max(...to.map((y) => tokenSimilarity(x, y))), 0);
  return (matched(ta, tb) + matched(tb, ta)) / (ta.length + tb.length);
}

/** Lowest similarity that is still suggested. */
export const EVENT_SUGGESTION_MIN_SCORE = 0.5;
export const EVENT_SUGGESTION_LIMIT = 5;

export type EventSuggestion = { id: number; name: string; score: number };

/** Events with a name similar to `name`, best first. */
export function suggestEvents(
  name: string,
  events: readonly { id: number; name: string }[],
  limit = EVENT_SUGGESTION_LIMIT,
): EventSuggestion[] {
  return events
    .map((event) => ({
      id: event.id,
      name: event.name,
      score: Math.round(eventNameSimilarity(name, event.name) * 1000) / 1000,
    }))
    .filter((s) => s.score >= EVENT_SUGGESTION_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, limit);
}

/** Same name apart from case, diacritics and spacing: such an event is reused, not duplicated. */
export function sameEventName(a: string, b: string): boolean {
  const key = (s: string) => foldText(s).replace(/\s+/g, ' ').trim();
  return key(a) === key(b);
}
