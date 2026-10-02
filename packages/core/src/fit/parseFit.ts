import {
  Decoder,
  Stream as FitStream,
  type ActivityMesg,
  type EventMesg,
  type FitMessages,
  type RecordMesg,
  type SessionMesg,
} from '@garmin/fitsdk';
import { formatLocalDate } from '../format';
import { sha256Hex } from '../hash';
import type { NormalizedActivity, Split, Stream } from '../schemas';
import type { Sport } from '../sports';
import { computeSplits, streamElevationGainM } from '../stream';

/**
 * FIT activity file → `NormalizedActivity` (PLAN.md 6.2), built on the official Garmin FIT
 * SDK. Runs in the browser (Web Worker) for the preview and on the server, which re-parses
 * every uploaded file instead of trusting the client.
 */

export const FIT_ERROR_CODES = [
  /** Not a FIT file at all. */
  'not_fit',
  /** A FIT file that cannot be decoded (truncated, bad CRC, …). */
  'corrupt',
  /** A FIT file of another kind (course, workout, settings, …). */
  'not_activity',
  /** An activity without a session summary. */
  'no_session',
  /** More than one session (multisport). */
  'multisport',
  'unsupported_sport',
  /** No distance (e.g. strength training). */
  'no_distance',
] as const;
export type FitErrorCode = (typeof FIT_ERROR_CODES)[number];

/** Where the detected sport came from (shown in the review step). */
export type SportSource = 'sport' | 'sub_sport' | 'profile_name' | 'elevation';
/** Where the race flag came from: the activity profile name, or nothing found. */
export type RaceSource = 'profile_name' | null;

export type FitDetails = {
  /** Activity profile chosen on the watch, e.g. "Bieg" or "Bieg zawody". */
  sportProfileName: string | null;
  /** Raw FIT values, e.g. `running` / `trail`. */
  fitSport: string;
  fitSubSport: string | null;
  sportSource: SportSource;
  raceSource: RaceSource;
  /** Local time offset at the start, in seconds east of UTC. */
  utcOffsetS: number;
};

export type FitActivity = NormalizedActivity & { fileName: string; fileSha256: string };

export type FitParseResult =
  | { ok: true; activity: FitActivity; details: FitDetails }
  | {
      ok: false;
      error: FitErrorCode;
      fileName: string;
      fileSha256: string;
      /** For `unsupported_sport`: the raw FIT sport / sub-sport. */
      fitSport?: string;
      fitSubSport?: string | null;
    };

/** Activity profile names that mark a race (PLAN.md Q1: the user's "Bieg zawody" profile). */
const RACE_PROFILE_RE = /zawod|race|wyścig/i;
/** Activity profile names that mark trail running. */
const TRAIL_PROFILE_RE = /trail|teren|prze[lł]aj|g[oó]rsk/i;
/** Average climb (m per km) from which a run counts as trail running. */
export const TRAIL_MIN_ASCENT_M_PER_KM = 20;
/** Indoor runs: the distance is not measured by GPS, so they are not imported. */
const INDOOR_RUN_SUB_SPORTS = new Set(['treadmill', 'indoorRunning', 'virtualActivity']);

/** Faster than this between two samples is a GPS jump (m/s). */
const MAX_SPEED_MPS: Record<Sport, number> = { road_run: 12, trail_run: 12, xc_ski: 25 };

const TIMER_STOP_TYPES = new Set(['stop', 'stopAll', 'stopDisable', 'stopDisableAll']);
/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH_S = 631065600;
const FALLBACK_TIME_ZONE = 'Europe/Warsaw';

/** "Export original" from Garmin Connect: `<activityId>.zip` with `<activityId>_ACTIVITY.fit`. */
const GARMIN_CONNECT_FILE_RE = /^(\d+)_ACTIVITY\.fit$/i;

/** Garmin Connect link of an activity, from the file name of an exported original. */
export function garminConnectUrl(fileName: string): string | null {
  const id = GARMIN_CONNECT_FILE_RE.exec(fileName)?.[1];
  return id ? `https://connect.garmin.com/app/activity/${id}` : null;
}

function toMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  // Without date conversion the SDK returns seconds since the FIT epoch.
  if (typeof value === 'number') return (value + FIT_EPOCH_S) * 1000;
  return null;
}

/** FIT `local_date_time` as seconds since the FIT epoch (the SDK may return a Date). */
function localFitSeconds(value: unknown): number | null {
  if (value instanceof Date) return value.getTime() / 1000 - FIT_EPOCH_S;
  return typeof value === 'number' ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Offset of an IANA time zone at a given instant, in seconds east of UTC. */
function zoneOffsetS(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 1000);
}

/**
 * Local time offset of the activity: from the activity message (`local_timestamp` vs
 * `timestamp`), else from a timestamp correlation message, else the default time zone.
 */
function utcOffsetS(messages: FitMessages, startMs: number): number {
  const candidates: { timestamp?: unknown; localTimestamp?: unknown }[] = [
    ...((messages.activityMesgs ?? []) as ActivityMesg[]),
    ...(messages.timestampCorrelationMesgs ?? []),
  ];
  for (const m of candidates) {
    const utcMs = toMs(m.timestamp);
    const local = localFitSeconds(m.localTimestamp);
    if (utcMs !== null && local !== null) {
      const offset = Math.round(local - (utcMs / 1000 - FIT_EPOCH_S));
      // Valid offsets are within ±14 h; round to a quarter of an hour.
      if (Math.abs(offset) <= 14 * 3600) return Math.round(offset / 900) * 900;
    }
  }
  return zoneOffsetS(startMs, FALLBACK_TIME_ZONE);
}

type SportDetection =
  { ok: true; sport: Sport; source: SportSource } | { ok: false; error: 'unsupported_sport' };

/** Sport mapping (PLAN.md 6.2) with the trail heuristic agreed for the user's watch. */
export function detectSport(input: {
  fitSport: string;
  fitSubSport: string | null;
  profileName: string | null;
  distanceM: number;
  totalAscentM: number | null;
}): SportDetection {
  const { fitSport, fitSubSport, profileName, distanceM, totalAscentM } = input;
  if (fitSport === 'crossCountrySkiing') return { ok: true, sport: 'xc_ski', source: 'sport' };
  if (fitSport !== 'running') return { ok: false, error: 'unsupported_sport' };
  if (fitSubSport && INDOOR_RUN_SUB_SPORTS.has(fitSubSport)) {
    return { ok: false, error: 'unsupported_sport' };
  }
  if (fitSubSport === 'trail') return { ok: true, sport: 'trail_run', source: 'sub_sport' };
  if (profileName && TRAIL_PROFILE_RE.test(profileName)) {
    return { ok: true, sport: 'trail_run', source: 'profile_name' };
  }
  if (
    totalAscentM !== null &&
    distanceM > 0 &&
    (totalAscentM / distanceM) * 1000 >= TRAIL_MIN_ASCENT_M_PER_KM
  ) {
    return { ok: true, sport: 'trail_run', source: 'elevation' };
  }
  return { ok: true, sport: 'road_run', source: 'sport' };
}

/** Race flag from the activity profile name (PLAN.md Q1). */
export function detectRace(profileName: string | null): {
  isRace: boolean;
  isRaceConfidence: 'fit' | 'none';
  raceSource: RaceSource;
} {
  return profileName && RACE_PROFILE_RE.test(profileName)
    ? { isRace: true, isRaceConfidence: 'fit', raceSource: 'profile_name' }
    : { isRace: false, isRaceConfidence: 'none', raceSource: null };
}

/** Periods when the timer was running, from `timer` start/stop events (ms, end exclusive). */
function timerIntervals(events: readonly EventMesg[]): [number, number][] {
  const timer = events
    .filter((e) => e.event === 'timer')
    .map((e) => ({ ms: toMs(e.timestamp), type: String(e.eventType) }))
    .filter((e): e is { ms: number; type: string } => e.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (timer.length === 0) return [[-Infinity, Infinity]];
  const intervals: [number, number][] = [];
  let start: number | null = null;
  for (const e of timer) {
    if (e.type === 'start' && start === null) start = e.ms;
    else if (TIMER_STOP_TYPES.has(e.type) && start !== null) {
      intervals.push([start, e.ms]);
      start = null;
    }
  }
  if (start !== null) intervals.push([start, Infinity]);
  return intervals;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The stream `{t, d, alt}` from `record` messages:
 * - `t` is timer time: samples taken while the timer was stopped are dropped and paused
 *   periods do not count;
 * - samples without a distance are dropped; the distance never decreases, and a jump faster
 *   than the sport's maximum speed (a GPS glitch) is cut down to that speed;
 * - altitude is included when every kept sample has one (gaps are filled from neighbours).
 */
export function buildStream(
  records: readonly RecordMesg[],
  events: readonly EventMesg[],
  sport: Sport,
): Stream | null {
  const samples = records
    .map((r) => ({
      ms: toMs(r.timestamp),
      d: typeof r.distance === 'number' ? r.distance : null,
      alt: (r.enhancedAltitude ?? r.altitude) as number | undefined,
    }))
    .filter(
      (s): s is { ms: number; d: number; alt: number | undefined } => s.ms !== null && s.d !== null,
    )
    .sort((a, b) => a.ms - b.ms);
  if (samples.length === 0) return null;

  const intervals = timerIntervals(events);
  const maxSpeed = MAX_SPEED_MPS[sport];
  const t: number[] = [];
  const d: number[] = [];
  const alt: (number | null)[] = [];
  let interval = 0;
  /** Timer time of the intervals before the current one. */
  let doneS = 0;
  let jumpOffsetM = 0;
  let prevRawD: number | null = null;

  for (const s of samples) {
    while (interval < intervals.length && s.ms > intervals[interval]![1]) {
      const [start, end] = intervals[interval]!;
      if (Number.isFinite(start)) doneS += (end - start) / 1000;
      interval++;
    }
    const current = intervals[interval];
    if (!current || s.ms < current[0]) continue; // paused
    const startMs = Number.isFinite(current[0]) ? current[0] : samples[0]!.ms;
    const ts = round1(doneS + (s.ms - startMs) / 1000);

    let dist = s.d - jumpOffsetM;
    const prevT = t.at(-1);
    const prevD = d.at(-1);
    if (prevT !== undefined && prevD !== undefined && prevRawD !== null) {
      const allowed = maxSpeed * Math.max(ts - prevT, 1);
      const step = s.d - prevRawD;
      if (step > allowed) {
        jumpOffsetM += step - allowed;
        dist = s.d - jumpOffsetM;
      }
      dist = Math.max(dist, prevD);
    }
    prevRawD = s.d;

    const value = typeof s.alt === 'number' && Number.isFinite(s.alt) ? round1(s.alt) : null;
    if (prevT !== undefined && ts <= prevT) {
      // Same timer second: keep the latest sample.
      d[d.length - 1] = round1(dist);
      alt[alt.length - 1] = value ?? alt.at(-1) ?? null;
      continue;
    }
    t.push(ts);
    d.push(round1(dist));
    alt.push(value);
  }
  if (t.length < 2) return null;

  const stream: Stream = { t, d };
  const firstAlt = alt.find((a) => a !== null);
  if (firstAlt !== undefined) {
    let last: number = firstAlt as number;
    stream.alt = alt.map((a) => (a === null ? last : (last = a)));
  }
  return stream;
}

function fail(
  error: FitErrorCode,
  fileName: string,
  fileSha256: string,
  extra: { fitSport?: string; fitSubSport?: string | null } = {},
): FitParseResult {
  return { ok: false, error, fileName, fileSha256, ...extra };
}

/** Parses a FIT activity file. Never throws for bad input: errors come back as codes. */
export async function parseFit(bytes: Uint8Array, fileName: string): Promise<FitParseResult> {
  const fileSha256 = await sha256Hex(bytes);

  let messages: FitMessages;
  try {
    const stream = FitStream.fromByteArray(bytes);
    if (!Decoder.isFIT(stream)) return fail('not_fit', fileName, fileSha256);
    const decoder = new Decoder(stream);
    if (!decoder.checkIntegrity()) return fail('corrupt', fileName, fileSha256);
    const result = decoder.read({ mergeHeartRates: false, includeUnknownData: false });
    if (result.errors.length > 0) return fail('corrupt', fileName, fileSha256);
    messages = result.messages;
  } catch {
    return fail('corrupt', fileName, fileSha256);
  }

  const fileId = messages.fileIdMesgs?.[0];
  if (!fileId || String(fileId.type) !== 'activity') {
    return fail('not_activity', fileName, fileSha256);
  }
  const sessions: SessionMesg[] = messages.sessionMesgs ?? [];
  if (sessions.length === 0) return fail('no_session', fileName, fileSha256);
  if (sessions.length > 1) return fail('multisport', fileName, fileSha256);
  const session = sessions[0]!;

  const fitSport = String(session.sport ?? messages.sportMesgs?.[0]?.sport ?? 'generic');
  const rawSubSport = session.subSport ?? messages.sportMesgs?.[0]?.subSport;
  const fitSubSport = rawSubSport === undefined ? null : String(rawSubSport);
  const profileName = text(session.sportProfileName) ?? text(messages.sportMesgs?.[0]?.name);
  const distanceM = typeof session.totalDistance === 'number' ? session.totalDistance : 0;
  const totalAscentM = typeof session.totalAscent === 'number' ? session.totalAscent : null;

  const detected = detectSport({ fitSport, fitSubSport, profileName, distanceM, totalAscentM });
  if (!detected.ok) {
    return fail('unsupported_sport', fileName, fileSha256, { fitSport, fitSubSport });
  }
  const timerS = session.totalTimerTime;
  if (!(distanceM > 0) || typeof timerS !== 'number' || !(timerS > 0)) {
    return fail('no_distance', fileName, fileSha256);
  }

  const records = messages.recordMesgs ?? [];
  const startMs =
    toMs(session.startTime) ?? toMs(records[0]?.timestamp) ?? toMs(fileId.timeCreated);
  if (startMs === null) return fail('corrupt', fileName, fileSha256);

  const offsetS = utcOffsetS(messages, startMs);
  const localDate = new Date(startMs + offsetS * 1000).toISOString().slice(0, 10);
  const stream = buildStream(records, messages.eventMesgs ?? [], detected.sport);
  const elevationGainM =
    totalAscentM ?? (stream ? Math.round(streamElevationGainM(stream) ?? NaN) : NaN);
  const splits: Split[] = stream ? computeSplits(stream, { totalAscentM }) : [];
  const race = detectRace(profileName);

  const createdMs = toMs(fileId.timeCreated);
  const serial = fileId.serialNumber;
  const externalId =
    typeof serial === 'number' && createdMs !== null
      ? `garmin:${serial}:${Math.round(createdMs / 1000)}`
      : undefined;
  const elapsedS =
    typeof session.totalElapsedTime === 'number' && session.totalElapsedTime >= timerS
      ? round1(session.totalElapsedTime)
      : undefined;

  const activityUrl = garminConnectUrl(fileName);

  const activity: FitActivity = {
    sport: detected.sport,
    name: [profileName?.slice(0, 180), formatLocalDate(localDate)].filter(Boolean).join(' '),
    startTimeUtc: new Date(startMs).toISOString(),
    localDate,
    distanceM: round1(distanceM),
    durationS: round1(timerS),
    ...(elapsedS !== undefined ? { elapsedS } : {}),
    ...(Number.isFinite(elevationGainM) ? { elevationGainM } : {}),
    isRace: race.isRace,
    isRaceConfidence: race.isRaceConfidence,
    ...(externalId ? { externalId } : {}),
    ...(activityUrl ? { activityUrl } : {}),
    fileName,
    fileSha256,
    ...(stream ? { stream } : {}),
    ...(splits.length > 0 ? { splits } : {}),
  };
  return {
    ok: true,
    activity,
    details: {
      sportProfileName: profileName,
      fitSport,
      fitSubSport,
      sportSource: detected.source,
      raceSource: race.raceSource,
      utcOffsetS: offsetS,
    },
  };
}
