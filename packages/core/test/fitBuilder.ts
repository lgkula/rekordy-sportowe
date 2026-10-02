import { Encoder } from '@garmin/fitsdk';

/**
 * Builds small synthetic FIT activity files with the Garmin SDK encoder, for edge cases the
 * real fixtures do not cover (pauses, GPS jumps, very short files, other sports).
 */

export type Sample = {
  /** Wall-clock seconds since the start. */
  s: number;
  /** Cumulative distance (m); null = sample without a distance. */
  d: number | null;
  alt?: number;
};

export type SyntheticActivity = {
  start?: Date;
  samples: Sample[];
  /** Timer stopped between these wall-clock seconds (stop, resume). */
  pauses?: [number, number][];
  sport?: string;
  subSport?: string;
  profileName?: string;
  totalAscent?: number;
  serialNumber?: number;
  fileType?: string;
  sessions?: number;
  /** Local time offset written in the activity message (s); omitted when undefined. */
  utcOffsetS?: number;
};

export const DEFAULT_START = new Date('2026-06-01T06:00:00Z');
const FIT_EPOCH_S = 631065600;
/** Global message numbers (Profile.MesgNum is typed as a loose record). */
const MESG = { FILE_ID: 0, SPORT: 12, SESSION: 18, RECORD: 20, EVENT: 21, ACTIVITY: 34 } as const;

/** Samples every second at a constant pace, altitude constant unless given. */
export function steadySamples(
  distanceM: number,
  paceSPerKm: number,
  altitude: (s: number) => number = () => 100,
): Sample[] {
  const speed = 1000 / paceSPerKm;
  const total = Math.ceil(distanceM / speed);
  return Array.from({ length: total + 1 }, (_, s) => ({
    s,
    d: Math.min(s * speed, distanceM),
    alt: altitude(s),
  }));
}

function at(start: Date, s: number): Date {
  return new Date(start.getTime() + s * 1000);
}

export function buildFit(activity: SyntheticActivity): Uint8Array {
  const start = activity.start ?? DEFAULT_START;
  const { samples, pauses = [] } = activity;
  const last = samples.at(-1)!;
  const end = at(start, last.s);
  const pausedS = pauses.reduce((sum, [stop, resume]) => sum + (resume - stop), 0);
  const sport = activity.sport ?? 'running';
  const subSport = activity.subSport ?? 'generic';

  const encoder = new Encoder();
  // The SDK types expect profile-typed messages; the test data uses plain objects.
  const write = (mesg: { mesgNum: number } & Record<string, unknown>) =>
    encoder.writeMesg(mesg as Parameters<Encoder['writeMesg']>[0]);
  write({
    mesgNum: MESG.FILE_ID,
    type: activity.fileType ?? 'activity',
    manufacturer: 'garmin',
    product: 3907,
    serialNumber: activity.serialNumber ?? 1234567890,
    timeCreated: start,
  });
  write({
    mesgNum: MESG.SPORT,
    sport,
    subSport,
    name: activity.profileName ?? 'Bieg',
  });
  write({
    mesgNum: MESG.EVENT,
    timestamp: start,
    event: 'timer',
    eventType: 'start',
  });

  const events = pauses.flatMap(([stop, resume]) => [
    { s: stop, eventType: 'stop' },
    { s: resume, eventType: 'start' },
  ]);
  for (const sample of samples) {
    while (events.length > 0 && events[0]!.s <= sample.s) {
      const e = events.shift()!;
      write({
        mesgNum: MESG.EVENT,
        timestamp: at(start, e.s),
        event: 'timer',
        eventType: e.eventType,
      });
    }
    write({
      mesgNum: MESG.RECORD,
      timestamp: at(start, sample.s),
      ...(sample.d === null ? {} : { distance: sample.d }),
      ...(sample.alt === undefined ? {} : { enhancedAltitude: sample.alt }),
    });
  }
  write({
    mesgNum: MESG.EVENT,
    timestamp: end,
    event: 'timer',
    eventType: 'stopAll',
  });

  const totalDistance = [...samples].reverse().find((x) => x.d !== null)?.d ?? 0;
  for (let i = 0; i < (activity.sessions ?? 1); i++) {
    write({
      mesgNum: MESG.SESSION,
      messageIndex: i,
      timestamp: end,
      startTime: start,
      sport,
      subSport,
      sportProfileName: activity.profileName ?? 'Bieg',
      totalElapsedTime: last.s,
      totalTimerTime: last.s - pausedS,
      totalDistance,
      ...(activity.totalAscent === undefined ? {} : { totalAscent: activity.totalAscent }),
      event: 'session',
      eventType: 'stop',
    });
  }
  write({
    mesgNum: MESG.ACTIVITY,
    timestamp: end,
    totalTimerTime: last.s - pausedS,
    numSessions: activity.sessions ?? 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
    ...(activity.utcOffsetS === undefined
      ? {}
      : { localTimestamp: end.getTime() / 1000 - FIT_EPOCH_S + activity.utcOffsetS }),
  });
  return encoder.close();
}
