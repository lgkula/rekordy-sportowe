import { z } from 'zod';
import { sportSchema } from './schemas';
import type { DistanceKey, Sport } from './sports';

/** Results shown per sport and distance (PLAN.md 4.2). */
export const RECORDS_TOP_N = 3;

export const recordsQuerySchema = z.object({ sport: sportSchema });
export type RecordsQuery = z.infer<typeof recordsQuerySchema>;

/** One result in the records view (`GET /api/records`). */
export type RecordEntry = {
  effortId: number;
  activityId: number;
  activityName: string;
  localDate: string;
  /** Garmin Connect / Strava link of the activity. */
  activityUrl: string | null;
  paceSPerKm: number;
  /** Null for tolerance results: only the pace is shown (D2). */
  durationS: number | null;
  actualDistanceM: number;
  isTolerance: boolean;
  origin: 'computed' | 'manual';
  isEdited: boolean;
};

export type DistanceRecords = {
  distanceKey: DistanceKey;
  targetM: number;
  /** Best first: pace ascending, the earlier activity first on a tie. */
  entries: RecordEntry[];
};

export type RecordsResponse = {
  sport: Sport;
  /** Only distances with at least one result, shortest first. */
  distances: DistanceRecords[];
};

/** A soft-deleted result, listed on the admin page so that it can be restored. */
export type DeletedEffort = Omit<RecordEntry, 'durationS'> & {
  sport: Sport;
  distanceKey: DistanceKey;
  durationS: number;
  /** When it was deleted (last change of the row). */
  deletedAt: string;
};

export const deletedEffortsQuerySchema = z.object({ sport: sportSchema.optional() });

export const JOB_TYPES = ['recompute_all'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type JobStatusValue = 'running' | 'done';

/**
 * A long maintenance job processed in chunks (PLAN.md 3.2): the browser (or the CLI) asks
 * for one chunk at a time, and the progress lives in the database, so a stopped process
 * loses nothing.
 */
export type Job = {
  id: number;
  type: JobType;
  status: JobStatusValue;
  /** Items to process (activities when the job started; grows if more are added). */
  total: number;
  processed: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** The chunk was not run because another request is processing this job right now. */
  busy?: boolean;
};
