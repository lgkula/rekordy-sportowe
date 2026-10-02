import type { FitParseResult } from '@rekordy/core/fit';
import type { FitWorkerRequest, FitWorkerResponse } from './fitWorker';
import type { UnzipResult } from './zip';

type Answer = Exclude<FitWorkerResponse, { failure: string }>;
type Pending = { resolve: (answer: Answer) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function failAll(error: Error): void {
  for (const p of pending.values()) p.reject(error);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./fitWorker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<FitWorkerResponse>) => {
    const p = pending.get(event.data.id);
    if (!p) return;
    pending.delete(event.data.id);
    if ('failure' in event.data) p.reject(new Error(event.data.failure));
    else p.resolve(event.data);
  };
  created.onerror = (event) => {
    // A crashed worker is replaced on the next call.
    failAll(new Error(event.message || 'FIT worker failed'));
    created.terminate();
    if (worker === created) worker = null;
  };
  worker = created;
  return created;
}

async function request(kind: FitWorkerRequest['kind'], file: File): Promise<Answer> {
  const buffer = await file.arrayBuffer();
  nextId += 1;
  const id = nextId;
  return new Promise<Answer>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const message: FitWorkerRequest = { id, kind, name: file.name, buffer };
    getWorker().postMessage(message, [buffer]);
  });
}

/** Parses a FIT file in the shared Web Worker. */
export async function parseFitInWorker(file: File): Promise<FitParseResult> {
  const answer = await request('parse', file);
  if (!('result' in answer)) throw new Error('Unexpected worker answer');
  return answer.result;
}

/** Extracts the FIT files of a ZIP archive in the shared Web Worker. */
export async function unzipInWorker(file: File): Promise<UnzipResult> {
  const answer = await request('unzip', file);
  if (!('unzipped' in answer)) throw new Error('Unexpected worker answer');
  return answer.unzipped;
}
