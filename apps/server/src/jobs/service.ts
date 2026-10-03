import type { Job, JobType } from '@rekordy/core';
import { and, asc, count, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { recomputeEfforts } from '../activities/efforts';
import type { Db } from '../db/client';
import { isDuplicateEntry } from '../db/errors';
import { activities, jobs } from '../db/schema';

/**
 * Chunked, resumable maintenance jobs (PLAN.md 3.2). Nothing runs in the background: each
 * chunk is one call (an HTTP request from the admin page, or a loop in the CLI). Progress is
 * committed per item, so a process stopped by Passenger mid-chunk loses at most the item in
 * flight, and the next call resumes after the cursor.
 */

export type ChunkLimits = { maxItems: number; maxMs: number };

/** One web request stays well below the host's request timeout. */
export const WEB_CHUNK: ChunkLimits = { maxItems: 200, maxMs: 5000 };
export const CLI_CHUNK: ChunkLimits = { maxItems: 500, maxMs: 30_000 };

/** A chunk holds the job this long; a lease left by a killed process then expires. */
export const LEASE_MS = 60_000;
/** Per-item errors kept in the job (the rest is counted). */
const MAX_ERROR_LINES = 20;

type JobRow = typeof jobs.$inferSelect;

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status,
    total: Math.max(row.total, row.processed),
    processed: row.processed,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

async function findJob(db: Db, id: number): Promise<JobRow | null> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}

export async function getJob(db: Db, id: number): Promise<Job | null> {
  const row = await findJob(db, id);
  return row && toJob(row);
}

/** The newest job of a type (running or finished), or null. */
export async function latestJob(db: Db, type: JobType): Promise<Job | null> {
  const [row] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.type, type))
    .orderBy(desc(jobs.id))
    .limit(1);
  return row ? toJob(row) : null;
}

/**
 * Starts recomputing the efforts of every activity (after a rule change), or returns the job
 * that is already running: at most one runs at a time (UNIQUE `active_key`).
 */
export async function startRecomputeAll(db: Db): Promise<{ job: Job; created: boolean }> {
  const type: JobType = 'recompute_all';
  const [totals] = await db.select({ total: count() }).from(activities);
  try {
    const [inserted] = await db
      .insert(jobs)
      .values({ type, activeKey: type, total: totals?.total ?? 0 })
      .$returningId();
    return { job: (await getJob(db, inserted!.id))!, created: true };
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;
  }
  const [running] = await db.select().from(jobs).where(eq(jobs.activeKey, type));
  if (!running) throw new Error('Running recompute job disappeared');
  return { job: toJob(running), created: false };
}

function appendError(current: string | null, line: string): string {
  const lines = current ? current.split('\n') : [];
  if (lines.length < MAX_ERROR_LINES) return [...lines, line].join('\n');
  return current!;
}

/**
 * Processes the next chunk of a running job. Returns the job afterwards, with `busy` set
 * when another call holds it right now (nothing was done), or null when it does not exist.
 */
export async function runJobChunk(
  db: Db,
  id: number,
  limits: ChunkLimits = WEB_CHUNK,
): Promise<Job | null> {
  const start = Date.now();
  const [claim] = await db
    .update(jobs)
    .set({ leaseUntilMs: start + LEASE_MS })
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.status, 'running'),
        or(isNull(jobs.leaseUntilMs), lt(jobs.leaseUntilMs, start)),
      ),
    );
  if (claim.affectedRows === 0) {
    const job = await getJob(db, id);
    return job && job.status === 'running' ? { ...job, busy: true } : job;
  }

  const job = (await findJob(db, id))!;
  let cursor = job.cursor;
  let done = 0;
  let finished = false;
  try {
    while (done < limits.maxItems && Date.now() - start < limits.maxMs) {
      const batch = await db
        .select({ id: activities.id })
        .from(activities)
        .where(gt(activities.id, cursor))
        .orderBy(asc(activities.id))
        .limit(Math.min(50, limits.maxItems - done));
      if (batch.length === 0) {
        finished = true;
        break;
      }
      for (const { id: activityId } of batch) {
        try {
          // The efforts and the job's progress are committed together.
          await db.transaction(async (tx) => {
            await recomputeEfforts(tx, activityId);
            await tx
              .update(jobs)
              .set({ cursor: activityId, processed: sql`${jobs.processed} + 1` })
              .where(eq(jobs.id, id));
          });
        } catch (error) {
          // One broken activity must not block the job: note it and move on.
          const message = error instanceof Error ? error.message : String(error);
          const current = await findJob(db, id);
          await db
            .update(jobs)
            .set({
              cursor: activityId,
              processed: sql`${jobs.processed} + 1`,
              error: appendError(current?.error ?? null, `#${activityId}: ${message}`),
            })
            .where(eq(jobs.id, id));
        }
        cursor = activityId;
        done++;
        if (Date.now() - start >= limits.maxMs) break;
      }
    }
    if (!finished) {
      // Finish now rather than one empty request later.
      const [next] = await db
        .select({ id: activities.id })
        .from(activities)
        .where(gt(activities.id, cursor))
        .limit(1);
      finished = !next;
    }
  } finally {
    await db
      .update(jobs)
      .set(
        finished
          ? {
              status: 'done',
              activeKey: null,
              leaseUntilMs: null,
              total: sql`${jobs.processed}`,
              finishedAt: new Date(),
            }
          : { leaseUntilMs: null },
      )
      .where(eq(jobs.id, id));
  }
  return getJob(db, id);
}
