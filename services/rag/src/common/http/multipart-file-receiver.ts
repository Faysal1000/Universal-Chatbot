import { createHash } from 'node:crypto';
import { PassThrough, type Readable, Transform, type TransformCallback } from 'node:stream';

import busboy from 'busboy';
import type { Request } from 'express';

import { ApplicationError } from '../errors/application-error.js';

/** Enough leading bytes for content sniffing of every supported format. */
const SNIFFED_HEAD_BYTES = 4_100;
const MAXIMUM_TEXT_FIELDS = 10;
const MAXIMUM_TEXT_FIELD_BYTES = 4_096;

export interface ReceivedFile {
  readonly fileName: string;
  readonly byteSize: number;
  readonly sha256: string;
  /** The first bytes, for detecting the real content type. */
  readonly headBytes: Buffer;
}

export interface ReceivedMultipartForm {
  readonly file: ReceivedFile;
  readonly textFields: Readonly<Record<string, string>>;
}

export interface MultipartFileOptions {
  readonly fileFieldName: string;
  readonly maximumFileBytes: number;
  /** Consumes the file bytes, e.g. a streaming upload to object storage. */
  readonly storeFile: (fileStream: Readable) => Promise<void>;
}

/**
 * Receives a `multipart/form-data` request with exactly one file, streaming it to
 * `storeFile` while hashing it, so a large upload never sits in memory.
 */
export function receiveMultipartFile(
  request: Request,
  options: MultipartFileOptions,
): Promise<ReceivedMultipartForm> {
  const formParser = createFormParser(request, options.maximumFileBytes);
  return new Promise((resolve, reject) => {
    const textFields: Record<string, string> = {};
    let fileReception: Promise<ReceivedFile> | undefined;

    formParser.on('field', (name, value) => {
      textFields[name] = value;
    });
    formParser.on('file', (name, fileStream, fileInfo) => {
      if (name !== options.fileFieldName || fileReception !== undefined) {
        fileStream.resume();
        return;
      }
      fileReception = receiveFileStream(fileStream, fileInfo.filename ?? '', options);
      // Avoid an unhandled rejection before 'close' attaches the real handler.
      fileReception.catch(() => undefined);
    });
    formParser.on('error', (error: unknown) => {
      reject(new ApplicationError(400, 'invalid_multipart', `The form data is malformed: ${String(error)}`));
    });
    formParser.on('close', () => {
      if (fileReception === undefined) {
        reject(missingFileError(options.fileFieldName));
        return;
      }
      fileReception.then((file) => {
        resolve({ file, textFields });
      }, reject);
    });
    request.once('close', () => {
      if (request.readableEnded) return;
      formParser.destroy();
      reject(new ApplicationError(400, 'request_aborted', 'The upload was interrupted.'));
    });
    request.pipe(formParser);
  });
}

function createFormParser(request: Request, maximumFileBytes: number): busboy.Busboy {
  try {
    return busboy({
      headers: request.headers,
      limits: {
        files: 1,
        fileSize: maximumFileBytes,
        fields: MAXIMUM_TEXT_FIELDS,
        fieldSize: MAXIMUM_TEXT_FIELD_BYTES,
      },
    });
  } catch {
    throw new ApplicationError(415, 'unsupported_media_type', 'Send the file as multipart/form-data.');
  }
}

async function receiveFileStream(
  fileStream: Readable,
  fileName: string,
  options: MultipartFileOptions,
): Promise<ReceivedFile> {
  const inspector = new FileInspector();
  const storedBytes = new PassThrough();
  const sizeLimit = { isExceeded: false };
  fileStream.on('limit', () => {
    sizeLimit.isExceeded = true;
    storedBytes.destroy(fileTooLargeError(options.maximumFileBytes));
  });
  fileStream.pipe(inspector).pipe(storedBytes);
  try {
    await options.storeFile(storedBytes);
  } catch (error: unknown) {
    fileStream.resume();
    throw sizeLimit.isExceeded ? fileTooLargeError(options.maximumFileBytes) : error;
  }
  if (sizeLimit.isExceeded) throw fileTooLargeError(options.maximumFileBytes);
  if (inspector.byteSize === 0) throw new ApplicationError(400, 'empty_file', 'The uploaded file is empty.');
  return { fileName, ...inspector.summary() };
}

/** Counts, hashes and keeps the head of the bytes flowing through it. */
class FileInspector extends Transform {
  byteSize = 0;
  private readonly hash = createHash('sha256');
  private readonly headChunks: Buffer[] = [];
  private headLength = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.byteSize += chunk.length;
    this.hash.update(chunk);
    if (this.headLength < SNIFFED_HEAD_BYTES) {
      this.headChunks.push(chunk.subarray(0, SNIFFED_HEAD_BYTES - this.headLength));
      this.headLength += Math.min(chunk.length, SNIFFED_HEAD_BYTES - this.headLength);
    }
    callback(null, chunk);
  }

  summary(): Omit<ReceivedFile, 'fileName'> {
    return {
      byteSize: this.byteSize,
      sha256: this.hash.digest('hex'),
      headBytes: Buffer.concat(this.headChunks),
    };
  }
}

function fileTooLargeError(maximumFileBytes: number): ApplicationError {
  return new ApplicationError(
    413,
    'payload_too_large',
    `The file exceeds the maximum upload size of ${maximumFileBytes} bytes.`,
  );
}

function missingFileError(fileFieldName: string): ApplicationError {
  return new ApplicationError(422, 'validation_failed', 'The request has no file.', {
    fieldErrors: [{ field: fileFieldName, message: 'A file is required.' }],
  });
}
