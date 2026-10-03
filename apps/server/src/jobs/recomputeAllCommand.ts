import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../config';
import { createDatabase } from '../db/client';
import { CLI_CHUNK, runJobChunk, startRecomputeAll } from './service';

/**
 * `node dist/tools.cjs recompute-all`: the same chunked job as the admin page, run in a loop
 * over SSH. Starts a new job or continues the one already running (e.g. interrupted in the
 * browser), so progress is shared with the page.
 */
export async function runRecomputeAll(): Promise<void> {
  const database = createDatabase(loadConfig());
  try {
    const { job: started, created } = await startRecomputeAll(database.db);
    console.log(
      created
        ? `Started job #${started.id}: ${started.total} activities`
        : `Resuming job #${started.id}: ${started.processed}/${started.total}`,
    );
    let job = started;
    while (job.status === 'running') {
      const next = await runJobChunk(database.db, job.id, CLI_CHUNK);
      if (!next) throw new Error(`Job #${job.id} disappeared`);
      // Another process (the admin page) is running a chunk: wait for it.
      if (next.busy) await sleep(2000);
      else console.log(`Progress: ${next.processed}/${next.total}`);
      job = next;
    }
    console.log(`Done: ${job.processed} activities recomputed.`);
    if (job.error) {
      console.error(`Errors:\n${job.error}`);
      process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
}
