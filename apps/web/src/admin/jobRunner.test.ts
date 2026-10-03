import type { Job } from '@rekordy/core';
import { describe, expect, it, vi } from 'vitest';
import { BUSY_RETRY_MS, driveJob, jobPercent } from './jobRunner';

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 7,
    type: 'recompute_all',
    status: 'running',
    total: 3,
    processed: 0,
    error: null,
    createdAt: '2026-10-03T10:00:00.000Z',
    updatedAt: '2026-10-03T10:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

describe('driveJob', () => {
  it('asks for chunks until the job is done', async () => {
    const chunks = [
      job({ processed: 2 }),
      job({ busy: true, processed: 2 }),
      job({ status: 'done', processed: 3 }),
    ];
    const runChunk = vi.fn(async () => chunks.shift()!);
    const onProgress = vi.fn();
    const wait = vi.fn(async () => {});
    const result = await driveJob(job(), { runChunk, onProgress, isCancelled: () => false, wait });
    expect(result).toMatchObject({ status: 'done', processed: 3 });
    expect(runChunk).toHaveBeenCalledTimes(3);
    expect(runChunk).toHaveBeenCalledWith(7);
    expect(onProgress).toHaveBeenCalledTimes(3);
    // Waits only while another process holds the job.
    expect(wait).toHaveBeenCalledExactlyOnceWith(BUSY_RETRY_MS);
  });

  it('stops after the current chunk when cancelled, leaving the job running', async () => {
    let cancelled = false;
    const runChunk = vi.fn(async () => {
      cancelled = true;
      return job({ processed: 1 });
    });
    const result = await driveJob(job(), {
      runChunk,
      onProgress: () => {},
      isCancelled: () => cancelled,
      wait: async () => {},
    });
    expect(result).toMatchObject({ status: 'running', processed: 1 });
    expect(runChunk).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a finished job', async () => {
    const runChunk = vi.fn();
    await driveJob(job({ status: 'done' }), {
      runChunk,
      onProgress: () => {},
      isCancelled: () => false,
      wait: async () => {},
    });
    expect(runChunk).not.toHaveBeenCalled();
  });
});

describe('jobPercent', () => {
  it('rounds and clamps the progress', () => {
    expect(jobPercent({ processed: 1, total: 3 })).toBe(33);
    expect(jobPercent({ processed: 5, total: 3 })).toBe(100);
    expect(jobPercent({ processed: 0, total: 0 })).toBe(100);
  });
});
