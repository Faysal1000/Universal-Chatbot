import { basename } from 'node:path';

/** The two processes built from this image: HTTP API, and BullMQ pipeline worker. */
export type ProcessRole = 'api' | 'worker';

export const SERVICE_NAME = 'rag';

/** Infers the role from the entry script (`main.api.js` / `main.worker.js`). */
export function detectProcessRole(entryScriptPath: string | undefined): ProcessRole {
  return entryScriptPath !== undefined && basename(entryScriptPath).startsWith('main.worker')
    ? 'worker'
    : 'api';
}
