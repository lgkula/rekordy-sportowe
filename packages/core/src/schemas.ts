import { z } from 'zod';
import { DISTANCES, DISTANCE_KEYS, qualifiesForTarget, SPORT_CONFIG, SPORTS } from './sports';
import type { DistanceKey, Sport } from './sports';

/**
 * Zod schemas shared by the web forms and the server (PLAN.md 6 and 7).
 * Messages are validation codes, not text: the web maps them to Polish strings
 * (`pl.validation` in apps/web), so all UI text stays in one module.
 */
export const VALIDATION_CODES = [
  'required',
  'too_long',
  'invalid_sport',
  'invalid_distance_key',
  'invalid_date',
  'invalid_datetime',
  'invalid_distance',
  'invalid_duration',
  'invalid_elevation',
  'invalid_url',
  'invalid_hash',
  'elapsed_lt_duration',
  'distance_not_for_sport',
  'effort_distance_too_short',
  'invalid_split',
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

const MAX_DISTANCE_M = 1_000_000;
/** One week: anything longer is a typo. */
const MAX_DURATION_S = 7 * 24 * 3600;
const MAX_ELEVATION_M = 30_000;

export const sportSchema = z.enum(SPORTS, { error: 'invalid_sport' });
export const distanceKeySchema = z.enum(DISTANCE_KEYS, { error: 'invalid_distance_key' });

const nameSchema = z
  .string({ error: 'required' })
  .trim()
  .min(1, { error: 'required' })
  .max(200, { error: 'too_long' });

/** Calendar date `YYYY-MM-DD` (local date of the activity). */
const localDateSchema = z.iso.date({ error: 'invalid_date' });
/** ISO timestamp in UTC, e.g. from `Date.toISOString()`. */
const utcDateTimeSchema = z.iso.datetime({ error: 'invalid_datetime' });

const distanceMSchema = z
  .number({ error: 'invalid_distance' })
  .positive({ error: 'invalid_distance' })
  .max(MAX_DISTANCE_M, { error: 'invalid_distance' });

const durationSSchema = z
  .number({ error: 'invalid_duration' })
  .positive({ error: 'invalid_duration' })
  .max(MAX_DURATION_S, { error: 'invalid_duration' });

const elevationSchema = z
  .number({ error: 'invalid_elevation' })
  .int({ error: 'invalid_elevation' })
  .min(0, { error: 'invalid_elevation' })
  .max(MAX_ELEVATION_M, { error: 'invalid_elevation' });

/** Optional text: an empty string is stored as null. */
const textOrNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'too_long' })
    .nullable()
    .transform((v) => (v === '' ? null : v));

const urlOrNull = z
  .union([
    z.literal('').transform(() => null),
    z.url({ protocol: /^https?$/, error: 'invalid_url' }).max(500, { error: 'too_long' }),
  ])
  .nullable();

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, { error: 'invalid_hash' });

export const splitSchema = z.object({
  km: z.number().int().positive({ error: 'invalid_split' }),
  distanceM: distanceMSchema,
  durationS: durationSSchema,
  elevationGainM: elevationSchema.nullable().optional(),
});
export type Split = z.infer<typeof splitSchema>;

const splitsSchema = z.array(splitSchema).max(500, { error: 'too_long' });

export const streamSchema = z.object({
  /** Timer time in seconds (auto-pause excluded). */
  t: z.array(z.number()),
  /** Cumulative distance in metres. */
  d: z.array(z.number()),
  /** Altitude in metres. */
  alt: z.array(z.number()).optional(),
});
export type Stream = z.infer<typeof streamSchema>;

/**
 * What every import pipeline produces (PLAN.md 6). `durationS` is the timer time
 * (auto-pause excluded, Q2); `elapsedS` the total time from start to finish.
 */
export const normalizedActivitySchema = z.object({
  sport: sportSchema,
  name: nameSchema,
  startTimeUtc: utcDateTimeSchema,
  distanceM: distanceMSchema,
  durationS: durationSSchema,
  elapsedS: durationSSchema.optional(),
  elevationGainM: elevationSchema.optional(),
  isRace: z.boolean(),
  isRaceConfidence: z.enum(['fit', 'heuristic', 'none']),
  externalId: z.string().max(100).optional(),
  fileName: z.string().max(255).optional(),
  fileSha256: sha256Schema.optional(),
  activityUrl: z
    .url({ protocol: /^https?$/, error: 'invalid_url' })
    .max(500)
    .optional(),
  stream: streamSchema.optional(),
  splits: splitsSchema.optional(),
});
export type NormalizedActivity = z.infer<typeof normalizedActivitySchema>;

/** A result entered by hand: distance key + time over the target (or the whole activity). */
export const manualEffortInputSchema = z.object({
  distanceKey: distanceKeySchema,
  durationS: durationSSchema,
});
export type ManualEffortInput = z.infer<typeof manualEffortInputSchema>;

/** Fields whose consistency depends on each other (also checked after a PATCH merge). */
export type ActivityConsistencyInput = {
  sport: Sport;
  distanceM: number;
  durationS?: number | null;
  elapsedS?: number | null;
  manualEffort?: ManualEffortInput | null;
};

export type ValidationIssue = { path: (string | number)[]; code: ValidationCode };

/** Cross-field rules of an activity; an empty list means it is consistent. */
export function activityIssues(a: ActivityConsistencyInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (a.elapsedS != null && a.durationS != null && a.elapsedS < a.durationS) {
    issues.push({ path: ['elapsedS'], code: 'elapsed_lt_duration' });
  }
  if (a.manualEffort) {
    const key: DistanceKey = a.manualEffort.distanceKey;
    if (!SPORT_CONFIG[a.sport].distanceKeys.includes(key)) {
      issues.push({ path: ['manualEffort', 'distanceKey'], code: 'distance_not_for_sport' });
    } else if (!qualifiesForTarget(a.distanceM, DISTANCES[key].targetM)) {
      issues.push({ path: ['manualEffort', 'distanceKey'], code: 'effort_distance_too_short' });
    }
  }
  return issues;
}

function refineActivity(value: ActivityConsistencyInput, ctx: z.RefinementCtx): void {
  for (const issue of activityIssues(value)) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.code });
  }
}

/** Full form: every activity field (PLAN.md 6.1). */
export const activityFullCreateSchema = z
  .object({
    mode: z.literal('full'),
    sport: sportSchema,
    name: nameSchema,
    localDate: localDateSchema,
    startTimeUtc: utcDateTimeSchema.nullable().optional(),
    distanceM: distanceMSchema,
    durationS: durationSSchema,
    elapsedS: durationSSchema.nullable().optional(),
    elevationGainM: elevationSchema.nullable().optional(),
    isRace: z.boolean().default(false),
    isHidden: z.boolean().default(false),
    editionLabel: textOrNull(100).optional(),
    notes: textOrNull(5000).optional(),
    activityUrl: urlOrNull.optional(),
    splits: splitsSchema.nullable().optional(),
    /** Save even though a similar activity exists (fuzzy duplicate, PLAN.md 4.4). */
    confirmDuplicate: z.boolean().optional(),
  })
  .superRefine(refineActivity);

/**
 * Simplified form: name, distance, date, a record on a chosen distance and a link. The whole
 * activity time is optional (the server fills it in when the activity is not longer than
 * the target, because the result time then covers the whole activity).
 */
export const activitySimpleCreateSchema = z
  .object({
    mode: z.literal('simple'),
    sport: sportSchema,
    name: nameSchema,
    localDate: localDateSchema,
    distanceM: distanceMSchema,
    durationS: durationSSchema.nullable().optional(),
    activityUrl: urlOrNull.optional(),
    manualEffort: manualEffortInputSchema,
    confirmDuplicate: z.boolean().optional(),
  })
  .superRefine(refineActivity);

export const activityCreateSchema = z.discriminatedUnion('mode', [
  activityFullCreateSchema,
  activitySimpleCreateSchema,
]);
export type ActivityCreateInput = z.input<typeof activityCreateSchema>;
export type ActivityCreate = z.output<typeof activityCreateSchema>;
export type ActivityFullCreate = z.output<typeof activityFullCreateSchema>;
export type ActivitySimpleCreate = z.output<typeof activitySimpleCreateSchema>;

/**
 * PATCH: absent fields stay unchanged, `null` clears an optional field. `manualEffort`
 * replaces (or with null removes) the hand-entered result. Cross-field rules are checked on
 * the merged activity with `activityIssues`.
 */
export const activityPatchSchema = z
  .object({
    sport: sportSchema,
    name: nameSchema,
    localDate: localDateSchema,
    startTimeUtc: utcDateTimeSchema.nullable(),
    distanceM: distanceMSchema,
    durationS: durationSSchema.nullable(),
    elapsedS: durationSSchema.nullable(),
    elevationGainM: elevationSchema.nullable(),
    isRace: z.boolean(),
    isHidden: z.boolean(),
    editionLabel: textOrNull(100),
    notes: textOrNull(5000),
    activityUrl: urlOrNull,
    splits: splitsSchema.nullable(),
    manualEffort: manualEffortInputSchema.nullable(),
  })
  .partial();
export type ActivityPatchInput = z.input<typeof activityPatchSchema>;
export type ActivityPatch = z.output<typeof activityPatchSchema>;

export const ACTIVITY_SORTS = ['date', 'name', 'distance'] as const;
export type ActivitySort = (typeof ACTIVITY_SORTS)[number];
export type SortDir = 'asc' | 'desc';

export const DEFAULT_PAGE_SIZE = 50;

export const activityListQuerySchema = z.object({
  sport: sportSchema.optional(),
  sort: z.enum(ACTIVITY_SORTS).default('date'),
  /** Default: newest first for dates, A→Z / shortest first otherwise. */
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(DEFAULT_PAGE_SIZE),
});
export type ActivityListQuery = z.input<typeof activityListQuerySchema>;
export type ActivityListParams = z.output<typeof activityListQuerySchema>;

export const ACTIVITY_SOURCES = [
  'manual',
  'manual_simple',
  'fit',
  'strava_export',
  'garmin_export',
  'agent',
] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export type ActivityListItem = {
  id: number;
  sport: Sport;
  name: string;
  localDate: string;
  startTimeUtc: string | null;
  distanceM: number;
  durationS: number | null;
  /** From the activity totals; null without a duration. */
  paceSPerKm: number | null;
  isRace: boolean;
  isHidden: boolean;
  source: ActivitySource;
  activityUrl: string | null;
};

export type ActivityListResponse = {
  items: ActivityListItem[];
  total: number;
  page: number;
  pageSize: number;
};

/** Effort (result on a record distance) as returned by the API. */
export const effortSchema = z.object({
  id: z.number().int(),
  activityId: z.number().int(),
  sport: sportSchema,
  distanceKey: distanceKeySchema,
  targetM: z.number(),
  actualDistanceM: z.number(),
  durationS: z.number(),
  paceSPerKm: z.number(),
  isTolerance: z.boolean(),
  origin: z.enum(['computed', 'manual']),
  isEdited: z.boolean(),
  isDeleted: z.boolean(),
});
export type Effort = z.infer<typeof effortSchema>;

/** Editing a result by hand (Part 4): the time and/or the distance it covers. */
export const effortPatchSchema = z
  .object({
    durationS: durationSSchema,
    actualDistanceM: distanceMSchema,
  })
  .partial();
export type EffortPatch = z.infer<typeof effortPatchSchema>;

export type ActivityDetail = ActivityListItem & {
  elapsedS: number | null;
  elevationGainM: number | null;
  eventId: number | null;
  editionLabel: string | null;
  notes: string | null;
  externalId: string | null;
  fileName: string | null;
  splits: Split[] | null;
  hasStream: boolean;
  createdAt: string;
  updatedAt: string;
  efforts: Effort[];
};

/** 409 body when saving would create a duplicate (PLAN.md 4.4). */
export type DuplicateConflict =
  | {
      code: 'duplicate';
      error: string;
      /** The field with the same value in the existing activity. */
      field: 'externalId' | 'fileName' | 'fileSha256';
      activity: ActivityListItem;
    }
  | {
      code: 'similar_activity';
      error: string;
      /** Similar activities; resend with `confirmDuplicate: true` to save anyway. */
      similar: ActivityListItem[];
    };
