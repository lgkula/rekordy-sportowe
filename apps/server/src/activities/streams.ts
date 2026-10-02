import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { streamSchema, type Stream } from '@rekordy/core';
import { eq } from 'drizzle-orm';
import { activityStreams } from '../db/schema';
import type { Executor } from './rows';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** `activity_streams.data`: gzip of JSON `{t, d, alt}` (PLAN.md 5). */
export async function encodeStream(stream: Stream): Promise<Buffer> {
  return gzipAsync(JSON.stringify(stream));
}

export async function decodeStream(data: Buffer): Promise<Stream> {
  const json: unknown = JSON.parse((await gunzipAsync(data)).toString('utf8'));
  return streamSchema.parse(json);
}

/** The stored stream of an activity, or null. */
export async function loadStream(db: Executor, activityId: number): Promise<Stream | null> {
  const [row] = await db
    .select({ data: activityStreams.data })
    .from(activityStreams)
    .where(eq(activityStreams.activityId, activityId));
  return row ? decodeStream(row.data) : null;
}
