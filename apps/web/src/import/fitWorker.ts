import { FIT_MAX_FILE_BYTES } from '@rekordy/core';
import { parseFit, type FitParseResult } from '@rekordy/core/fit';
import { extractFitFiles, type UnzipResult } from './zip';

/**
 * Web Worker: parses FIT files and unpacks ZIP archives off the main thread, so the page
 * stays responsive.
 */

export type FitWorkerRequest = {
  id: number;
  kind: 'parse' | 'unzip';
  name: string;
  buffer: ArrayBuffer;
};
export type FitWorkerResponse =
  | { id: number; result: FitParseResult }
  | { id: number; unzipped: UnzipResult }
  | { id: number; failure: string };

// The project compiles with the DOM lib, where `self` is a Window; type the worker scope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FitWorkerRequest>) => void) | null;
  postMessage: (message: FitWorkerResponse) => void;
};

async function handle(request: FitWorkerRequest): Promise<void> {
  const bytes = new Uint8Array(request.buffer);
  if (request.kind === 'unzip') {
    // Copied, not transferred: entries stored without compression may share a buffer.
    scope.postMessage({ id: request.id, unzipped: extractFitFiles(bytes, FIT_MAX_FILE_BYTES) });
    return;
  }
  scope.postMessage({ id: request.id, result: await parseFit(bytes, request.name) });
}

scope.onmessage = (event) => {
  handle(event.data).catch((error: unknown) =>
    scope.postMessage({ id: event.data.id, failure: String(error) }),
  );
};
