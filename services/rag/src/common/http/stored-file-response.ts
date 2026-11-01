import { pipeline } from 'node:stream/promises';

import type { Response } from 'express';

import type { StoredObjectStream } from '../../ports/object-storage.port.js';

export interface StoredFileResponseOptions {
  /** Sent as an attachment with this name; omitted for inline images. */
  readonly downloadFileName?: string;
  /** Private: admin and visitor content must never sit in shared caches. */
  readonly maxAgeSeconds: number;
}

/** Streams an object-storage file to the client without buffering it. */
export async function sendStoredFile(
  response: Response,
  storedFile: StoredObjectStream,
  options: StoredFileResponseOptions,
): Promise<void> {
  response.status(200);
  if (options.downloadFileName !== undefined) response.attachment(options.downloadFileName);
  response.setHeader('Content-Type', storedFile.contentType ?? 'application/octet-stream');
  if (storedFile.contentLength !== undefined) {
    response.setHeader('Content-Length', String(storedFile.contentLength));
  }
  response.setHeader('Cache-Control', `private, max-age=${options.maxAgeSeconds}`);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  await pipeline(storedFile.body, response);
}
