import { z } from 'zod';
import { distanceMSchema, eventNameSchema, sportSchema } from './schemas';
import { SPORT_CONFIG, type Sport } from './sports';

/**
 * Races grouped into events (PLAN.md 4.3): an event's editions are its race activities.
 * Aggregation and ordering are pure functions, used by the server and the web alike.
 */

export const EVENT_ORDERINGS = ['manual', 'name'] as const;
export type EventOrdering = (typeof EVENT_ORDERINGS)[number];
export const DEFAULT_EVENT_ORDERING: EventOrdering = 'manual';

/** Setting key of a sport's event ordering (`settings` table). */
export function eventOrderingKey(sport: Sport): string {
  return `events.ordering.${sport}`;
}

/** One edition of an event: a race activity. */
export type EventEdition = {
  activityId: number;
  activityName: string;
  editionLabel: string | null;
  localDate: string;
  startTimeUtc: string | null;
  distanceM: number;
  /** Null for a simplified entry without the whole-activity time. */
  durationS: number | null;
  paceSPerKm: number | null;
  elevationGainM: number | null;
  /** Shown greyed out; does not count for the event's pace, elevation or distance. */
  isHidden: boolean;
};

/**
 * An entry of the races list. A race activity without an event is listed as a one-edition
 * event of its own (`id` null, `activityId` set) until it is assigned.
 */
export type EventListItem = {
  /** `e<event id>` or `a<activity id>` (unassigned race). */
  key: string;
  id: number | null;
  activityId: number | null;
  sport: Sport;
  name: string;
  /** The distance shown: the manual one, otherwise the one computed from the editions. */
  distanceM: number | null;
  /** Set by hand (PLAN.md Q9), null when computed. */
  displayDistanceM: number | null;
  computedDistanceM: number | null;
  /** Best pace across the visible editions. */
  bestPaceSPerKm: number | null;
  bestEdition: EventEdition | null;
  /** Elevation gain of the best-pace edition (Q6), only for sports that track it. */
  elevationGainM: number | null;
  editionCount: number;
  /** Manual order; null for unassigned races (listed after the events). */
  sortOrder: number | null;
  latestDate: string | null;
};

export type EventListResponse = {
  sport: Sport;
  ordering: EventOrdering;
  events: EventListItem[];
};

export type EventDetail = EventListItem & { id: number; editions: EventEdition[] };

/** Pace of an edition from its totals, s/km rounded to 0.001 s; null without a time. */
export function editionPace(distanceM: number, durationS: number | null): number | null {
  if (durationS === null || !(distanceM > 0)) return null;
  return Math.round((durationS / distanceM) * 1_000_000) / 1000;
}

/** Editions within this ratio of each other count as the same distance. */
export const EVENT_DISTANCE_RATIO = 0.03;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Visible editions, or all of them when every edition is hidden. */
function countedForDistance(editions: readonly EventEdition[]): readonly EventEdition[] {
  const visible = editions.filter((e) => !e.isHidden);
  return visible.length > 0 ? visible : editions;
}

/**
 * The most common edition distance (PLAN.md 4.3): editions within ±3% of each other form a
 * group (GPS noise, small course changes); the largest group wins, on a tie the one with the
 * newest edition. Its median, rounded to 10 m.
 */
export function computedEventDistanceM(editions: readonly EventEdition[]): number | null {
  const pool = countedForDistance(editions);
  let best: { size: number; latest: string; members: EventEdition[] } | null = null;
  for (const center of pool) {
    const members = pool.filter(
      (e) => Math.abs(e.distanceM - center.distanceM) <= center.distanceM * EVENT_DISTANCE_RATIO,
    );
    const latest = members.reduce((max, e) => (e.localDate > max ? e.localDate : max), '');
    if (
      !best ||
      members.length > best.size ||
      (members.length === best.size && latest > best.latest)
    ) {
      best = { size: members.length, latest, members };
    }
  }
  return best ? Math.round(median(best.members.map((e) => e.distanceM)) / 10) * 10 : null;
}

/** Newest first: date, then start time, then activity id. */
export function compareEditions(a: EventEdition, b: EventEdition): number {
  return (
    b.localDate.localeCompare(a.localDate) ||
    (b.startTimeUtc ?? '').localeCompare(a.startTimeUtc ?? '') ||
    b.activityId - a.activityId
  );
}

export type EventAggregate = Pick<
  EventListItem,
  | 'distanceM'
  | 'computedDistanceM'
  | 'bestPaceSPerKm'
  | 'bestEdition'
  | 'elevationGainM'
  | 'editionCount'
  | 'latestDate'
>;

/**
 * Aggregated values of an event: the best pace of all visible editions (hidden ones are
 * shown but do not count; on a tie the earlier edition), the elevation gain of that edition
 * (Q6, only for sports that track elevation), the distance (manual, otherwise computed).
 */
export function aggregateEvent(
  sport: Sport,
  editions: readonly EventEdition[],
  displayDistanceM: number | null,
): EventAggregate {
  let best: EventEdition | null = null;
  for (const edition of editions) {
    if (edition.isHidden || edition.paceSPerKm === null) continue;
    if (
      !best ||
      edition.paceSPerKm < best.paceSPerKm! ||
      (edition.paceSPerKm === best.paceSPerKm && compareEditions(edition, best) > 0)
    ) {
      best = edition;
    }
  }
  const computedDistanceM = computedEventDistanceM(editions);
  return {
    distanceM: displayDistanceM ?? computedDistanceM,
    computedDistanceM,
    bestPaceSPerKm: best?.paceSPerKm ?? null,
    bestEdition: best,
    elevationGainM: SPORT_CONFIG[sport].tracksElevation ? (best?.elevationGainM ?? null) : null,
    editionCount: editions.length,
    latestDate: editions.reduce<string | null>(
      (max, e) => (max === null || e.localDate > max ? e.localDate : max),
      null,
    ),
  };
}

const nameCollator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

/** Polish alphabetical order ("Łódź" after "Lublin", "Śnieżka" after "Sobótka"). */
export function compareNamesPl(a: string, b: string): number {
  return nameCollator.compare(a, b);
}

/**
 * Order of the races list. Manual: events by their saved order, then unassigned races,
 * newest first. By name: everything alphabetically with Polish collation.
 */
export function sortEventList<
  T extends Pick<EventListItem, 'id' | 'activityId' | 'name' | 'sortOrder' | 'latestDate'>,
>(items: readonly T[], ordering: EventOrdering): T[] {
  const byIdentity = (a: T, b: T) =>
    (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0) ||
    (a.id ?? 0) - (b.id ?? 0) ||
    (a.activityId ?? 0) - (b.activityId ?? 0);
  if (ordering === 'name') {
    return [...items].sort((a, b) => compareNamesPl(a.name, b.name) || byIdentity(a, b));
  }
  return [...items].sort((a, b) => {
    if (a.id !== null && b.id !== null) {
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
    }
    if (a.id !== null || b.id !== null) return a.id === null ? 1 : -1;
    return (
      (b.latestDate ?? '').localeCompare(a.latestDate ?? '') ||
      (b.activityId ?? 0) - (a.activityId ?? 0)
    );
  });
}

// ---- API schemas -------------------------------------------------------------------------

const idSchema = z.number().int().positive();

export const eventListQuerySchema = z.object({ sport: sportSchema });

export const eventSuggestQuerySchema = z.object({
  sport: sportSchema,
  name: z.string().max(200),
});

export const eventCreateSchema = z.object({
  sport: sportSchema,
  name: eventNameSchema,
  displayDistanceM: distanceMSchema.nullable().optional(),
  /** Race activities to assign right away (e.g. turning an unassigned race into an event). */
  activityIds: z.array(idSchema).max(500).optional(),
});
export type EventCreateInput = z.input<typeof eventCreateSchema>;
export type EventCreate = z.output<typeof eventCreateSchema>;

export const eventPatchSchema = z
  .object({
    name: eventNameSchema,
    /** Null: computed from the editions again. */
    displayDistanceM: distanceMSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), { error: 'required' });
export type EventPatchInput = z.input<typeof eventPatchSchema>;

/** Moves every edition of the event into `targetId` and deletes the event. */
export const eventMergeSchema = z.object({ targetId: idSchema });

/** Saves the manual order of a sport's events (first = top). */
export const eventOrderSchema = z.object({
  sport: sportSchema,
  ids: z.array(idSchema).max(1000),
});
export type EventOrderInput = z.input<typeof eventOrderSchema>;

/** Settings that the API reads and writes, with the schema of their value. */
export function settingValueSchema(key: string): z.ZodType | null {
  const match = /^events\.ordering\.(.+)$/.exec(key);
  if (match && sportSchema.safeParse(match[1]).success) return z.enum(EVENT_ORDERINGS);
  return null;
}

/** Value of a setting that was never saved. */
export function settingDefault(key: string): unknown {
  return key.startsWith('events.ordering.') ? DEFAULT_EVENT_ORDERING : null;
}

export type SettingResponse = { key: string; value: unknown };
