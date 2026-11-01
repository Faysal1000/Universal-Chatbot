import type { Readable } from 'node:stream';

export interface StoredObjectStream {
  readonly body: Readable;
  readonly contentType: string | undefined;
  readonly contentLength: number | undefined;
}

/** Bucket-scoped object storage (MinIO / S3). Keys are relative to the service bucket. */
export interface ObjectStoragePort {
  readonly bucketName: string;
  /** Streams `body` to `key` with a multipart upload; memory use stays constant. */
  uploadStream(key: string, body: Readable, contentType: string): Promise<void>;
  putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  readBytes(key: string): Promise<Buffer>;
  openReadStream(key: string): Promise<StoredObjectStream>;
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  /** Deletes every object under `prefix` and returns how many were removed. */
  deletePrefix(prefix: string): Promise<number>;
}

export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');

/** Raised when a key does not exist, so callers can map it to a 404 instead of a 500. */
export class StoredObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object ${key} does not exist`);
    this.name = 'StoredObjectNotFoundError';
  }
}
