import type { Job } from '@rekordy/core';

export type JobRunnerDeps = {
  runChunk: (id: number) => Promise<Job>;
  onProgress: (job: Job) => void;
  /** True once the page was left: stop after the current chunk (the job stays resumable). */
  isCancelled: () => boolean;
  wait: (ms: number) => Promise<void>;
};

/** Pause before asking again while another window (or the SSH command) runs a chunk. */
export const BUSY_RETRY_MS = 2000;

/**
 * Drives a chunked server job from the browser: asks for one chunk at a time until the job
 * is done. Progress lives on the server, so stopping half-way loses nothing.
 */
export async function driveJob(job: Job, deps: JobRunnerDeps): Promise<Job> {
  let current = job;
  while (current.status === 'running' && !deps.isCancelled()) {
    current = await deps.runChunk(current.id);
    deps.onProgress(current);
    if (current.busy && current.status === 'running') await deps.wait(BUSY_RETRY_MS);
  }
  return current;
}

/** Progress in percent (0–100). */
export function jobPercent(job: Pick<Job, 'processed' | 'total'>): number {
  if (job.total <= 0) return 100;
  return Math.min(100, Math.round((job.processed / job.total) * 100));
}
