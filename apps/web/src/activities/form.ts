import {
  activityFullCreateSchema,
  activitySimpleCreateSchema,
  ENABLED_SPORTS,
  formatDistanceInput,
  formatDurationInput,
  parseDistanceKm,
  parseDuration,
  SPORT_CONFIG,
  type ActivityCreate,
  type ActivityDetail,
  type ActivityPatchInput,
  type DistanceKey,
  type Sport,
  type ValidationCode,
} from '@rekordy/core';
import { choiceOf, eventAssignment, NO_EVENT, type EventChoice } from '../events/eventChoice';

export type FormMode = 'full' | 'simple';

export type SplitFormValues = { distance: string; duration: string; elevationGain: string };

/** Form state: text exactly as typed; parsed and validated on submit. */
export type ActivityFormValues = {
  sport: Sport;
  name: string;
  /** `YYYY-MM-DD` or empty. */
  localDate: string;
  /** `HH:mm` (local time) or empty. */
  startTime: string;
  distance: string;
  duration: string;
  elapsed: string;
  elevationGain: string;
  isRace: boolean;
  isHidden: boolean;
  /** Event and edition label: used only for a race. */
  event: EventChoice;
  editionLabel: string;
  notes: string;
  activityUrl: string;
  effortKey: DistanceKey | '';
  effortDuration: string;
  splits: SplitFormValues[];
};

/** Field → validation code (mapped to Polish text by the caller). */
export type FormErrors = Record<string, ValidationCode>;

export function emptyFormValues(sport: Sport = ENABLED_SPORTS[0]!): ActivityFormValues {
  return {
    sport,
    name: '',
    localDate: '',
    startTime: '',
    distance: '',
    duration: '',
    elapsed: '',
    elevationGain: '',
    isRace: false,
    isHidden: false,
    event: NO_EVENT,
    editionLabel: '',
    notes: '',
    activityUrl: '',
    effortKey: '',
    effortDuration: '',
    splits: [],
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local `HH:mm` of an ISO timestamp (the browser's time zone). */
export function localTimeOf(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** ISO timestamp of a local date and `HH:mm` time (the browser's time zone). */
export function toUtcIso(localDate: string, time: string): string | null {
  const date = new Date(`${localDate}T${time}:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Form values for editing an existing activity. */
export function detailToFormValues(activity: ActivityDetail): ActivityFormValues {
  const manual = activity.efforts.find((e) => e.origin === 'manual');
  return {
    sport: activity.sport,
    name: activity.name,
    localDate: activity.localDate,
    startTime: activity.startTimeUtc ? localTimeOf(activity.startTimeUtc) : '',
    distance: formatDistanceInput(activity.distanceM),
    duration: activity.durationS === null ? '' : formatDurationInput(activity.durationS),
    elapsed: activity.elapsedS === null ? '' : formatDurationInput(activity.elapsedS),
    elevationGain: activity.elevationGainM === null ? '' : String(activity.elevationGainM),
    isRace: activity.isRace,
    isHidden: activity.isHidden,
    event: choiceOf(activity.eventId, activity.eventName),
    editionLabel: activity.editionLabel ?? '',
    notes: activity.notes ?? '',
    activityUrl: activity.activityUrl ?? '',
    effortKey: manual?.distanceKey ?? '',
    effortDuration: manual ? formatDurationInput(manual.durationS) : '',
    splits: (activity.splits ?? []).map((split) => ({
      distance: formatDistanceInput(split.distanceM),
      duration: formatDurationInput(split.durationS),
      elevationGain: split.elevationGainM == null ? '' : String(split.elevationGainM),
    })),
  };
}

/** Form field that shows an error for a schema path. */
function fieldOf(path: PropertyKey[]): string {
  const [first, second, third] = path.map(String);
  switch (first) {
    case 'distanceM':
      return 'distance';
    case 'durationS':
      return 'duration';
    case 'elapsedS':
      return 'elapsed';
    case 'elevationGainM':
      return 'elevationGain';
    case 'startTimeUtc':
      return 'startTime';
    case 'manualEffort':
      return second === 'durationS' ? 'effortDuration' : 'effortKey';
    case 'splits': {
      const field = {
        distanceM: 'distance',
        durationS: 'duration',
        elevationGainM: 'elevationGain',
      }[third ?? ''];
      return field ? `splits.${second}.${field}` : `splits.${second}.distance`;
    }
    default:
      return first ?? 'name';
  }
}

type Parsed<T> = { value: T } | { error: ValidationCode };

function parseRequired(text: string, parse: (s: string) => number | null, code: ValidationCode) {
  if (text.trim() === '') return { error: 'required' } as const;
  const value = parse(text);
  return value === null ? ({ error: code } as const) : { value };
}

function parseOptional(
  text: string,
  parse: (s: string) => number | null,
  code: ValidationCode,
): Parsed<number | null> {
  if (text.trim() === '') return { value: null };
  const value = parse(text);
  return value === null ? { error: code } : { value };
}

const parseInteger = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

export type FormResult = { ok: true; input: ActivityCreate } | { ok: false; errors: FormErrors };

/**
 * Parses the form (Polish number and time formats) and validates it with the schema shared
 * with the server. Only the fields of the chosen mode are used.
 */
export function parseActivityForm(values: ActivityFormValues, mode: FormMode): FormResult {
  const errors: FormErrors = {};
  const take = <T>(field: string, parsed: Parsed<T>): T | undefined => {
    if ('error' in parsed) {
      errors[field] = parsed.error;
      return undefined;
    }
    return parsed.value;
  };

  if (values.localDate === '') errors.localDate = 'required';
  const distanceM = take(
    'distance',
    parseRequired(values.distance, parseDistanceKm, 'invalid_distance'),
  );
  const common = {
    sport: values.sport,
    name: values.name,
    localDate: values.localDate,
    distanceM,
    activityUrl: values.activityUrl,
  };

  let candidate: Record<string, unknown>;
  if (mode === 'simple') {
    candidate = {
      ...common,
      mode,
      durationS: take(
        'duration',
        parseOptional(values.duration, parseDuration, 'invalid_duration'),
      ),
      manualEffort: {
        distanceKey: values.effortKey === '' ? undefined : values.effortKey,
        durationS: take(
          'effortDuration',
          parseRequired(values.effortDuration, parseDuration, 'invalid_duration'),
        ),
      },
    };
  } else {
    let startTimeUtc: string | null = null;
    if (values.startTime !== '' && values.localDate !== '') {
      startTimeUtc = toUtcIso(values.localDate, values.startTime);
      if (startTimeUtc === null) errors.startTime = 'invalid_datetime';
    }
    candidate = {
      ...common,
      mode,
      startTimeUtc,
      durationS: take(
        'duration',
        parseRequired(values.duration, parseDuration, 'invalid_duration'),
      ),
      elapsedS: take('elapsed', parseOptional(values.elapsed, parseDuration, 'invalid_duration')),
      elevationGainM: take(
        'elevationGain',
        parseOptional(values.elevationGain, parseInteger, 'invalid_elevation'),
      ),
      isRace: values.isRace,
      isHidden: values.isHidden,
      // Only a race belongs to an event and has an edition.
      ...(values.isRace ? eventAssignment(values.event) : { eventId: null }),
      editionLabel: values.isRace ? values.editionLabel : null,
      notes: values.notes,
      splits:
        values.splits.length === 0
          ? null
          : values.splits.map((split, i) => ({
              km: i + 1,
              distanceM: take(
                `splits.${i}.distance`,
                parseRequired(split.distance, parseDistanceKm, 'invalid_distance'),
              ),
              durationS: take(
                `splits.${i}.duration`,
                parseRequired(split.duration, parseDuration, 'invalid_duration'),
              ),
              elevationGainM: take(
                `splits.${i}.elevationGain`,
                parseOptional(split.elevationGain, parseInteger, 'invalid_elevation'),
              ),
            })),
    };
  }

  const schema = mode === 'simple' ? activitySimpleCreateSchema : activityFullCreateSchema;
  const result = schema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = fieldOf(issue.path);
      // A parse error from above is more precise than the schema's view of `undefined`.
      errors[field] ??= issue.message as ValidationCode;
    }
  }
  if (Object.keys(errors).length > 0 || !result.success) return { ok: false, errors };
  return { ok: true, input: result.data };
}

/**
 * PATCH body for an edit. The full form replaces every field; the simplified form changes
 * only its own fields and the hand-entered result.
 */
export function toPatch(input: ActivityCreate): ActivityPatchInput {
  if (input.mode === 'simple') {
    const { mode: _mode, confirmDuplicate: _confirm, durationS, activityUrl, ...rest } = input;
    return { ...rest, durationS: durationS ?? null, activityUrl: activityUrl ?? null };
  }
  const { mode: _mode, confirmDuplicate: _confirm, ...rest } = input;
  return {
    ...rest,
    startTimeUtc: rest.startTimeUtc ?? null,
    elapsedS: rest.elapsedS ?? null,
    elevationGainM: rest.elevationGainM ?? null,
    editionLabel: rest.editionLabel ?? null,
    eventId: rest.eventId ?? null,
    notes: rest.notes ?? null,
    activityUrl: rest.activityUrl ?? null,
    splits: rest.splits && rest.splits.length > 0 ? rest.splits : null,
  };
}

/** Record distances offered for the sport in the simplified form. */
export function effortKeysFor(sport: Sport): readonly DistanceKey[] {
  return SPORT_CONFIG[sport].distanceKeys;
}
