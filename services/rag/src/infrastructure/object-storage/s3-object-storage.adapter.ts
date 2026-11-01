import type { Readable } from 'node:stream';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Inject, Injectable } from '@nestjs/common';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import {
  type ObjectStoragePort,
  StoredObjectNotFoundError,
  type StoredObjectStream,
} from '../../ports/object-storage.port.js';
import { OBJECT_STORAGE_CLIENT } from './object-storage.tokens.js';

/** 8 MiB parts with 2 in flight keep a large upload at roughly 16 MiB of memory. */
const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MULTIPART_QUEUE_SIZE = 2;
/** S3 DeleteObjects accepts at most 1,000 keys per request. */
const MAXIMUM_KEYS_PER_DELETE = 1_000;

@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  readonly bucketName: string;

  constructor(
    @Inject(OBJECT_STORAGE_CLIENT) private readonly s3Client: S3Client,
    @Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration,
  ) {
    this.bucketName = configuration.objectStorage.bucket;
  }

  async uploadStream(key: string, body: Readable, contentType: string): Promise<void> {
    const upload = new Upload({
      client: this.s3Client,
      params: { Bucket: this.bucketName, Key: key, Body: body, ContentType: contentType },
      partSize: MULTIPART_PART_SIZE_BYTES,
      queueSize: MULTIPART_QUEUE_SIZE,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({ Bucket: this.bucketName, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  async readBytes(key: string): Promise<Buffer> {
    const storedObject = await this.openReadStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of storedObject.body) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  async openReadStream(key: string): Promise<StoredObjectStream> {
    try {
      const response = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
      if (response.Body === undefined) throw new StoredObjectNotFoundError(key);
      return {
        body: response.Body as Readable,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      };
    } catch (error: unknown) {
      throw translateNotFound(error, key);
    }
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName,
          Key: destinationKey,
          CopySource: `${this.bucketName}/${encodeURIComponent(sourceKey).replaceAll('%2F', '/')}`,
        }),
      );
    } catch (error: unknown) {
      throw translateNotFound(error, sourceKey);
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deletedCount = 0;
    let continuationToken: string | undefined;
    do {
      const page = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          MaxKeys: MAXIMUM_KEYS_PER_DELETE,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (page.Contents ?? []).flatMap((storedObject) =>
        storedObject.Key === undefined ? [] : [{ Key: storedObject.Key }],
      );
      if (keys.length > 0) {
        await this.s3Client.send(
          new DeleteObjectsCommand({ Bucket: this.bucketName, Delete: { Objects: keys, Quiet: true } }),
        );
        deletedCount += keys.length;
      }
      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
    return deletedCount;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof NoSuchKey || error instanceof NotFound;
}

function translateNotFound(error: unknown, key: string): unknown {
  return isNotFound(error) ? new StoredObjectNotFoundError(key) : error;
}
