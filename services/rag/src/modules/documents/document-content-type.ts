import { fileTypeFromBuffer } from 'file-type';

import { ApplicationError } from '../../common/errors/application-error.js';

/**
 * Upload types the document-parser can read. Office files are refused at upload
 * because the parser has no LibreOffice; convert them to PDF first.
 */
export const SUPPORTED_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
] as const;
export type SupportedDocumentContentType = (typeof SUPPORTED_DOCUMENT_CONTENT_TYPES)[number];

/** The content type from the file's own bytes; the client's declared type is never trusted. */
export async function detectDocumentContentType(headBytes: Buffer): Promise<SupportedDocumentContentType> {
  const detectedType = await fileTypeFromBuffer(headBytes);
  const supportedType = SUPPORTED_DOCUMENT_CONTENT_TYPES.find((type) => type === detectedType?.mime);
  if (supportedType !== undefined) return supportedType;
  throw new ApplicationError(
    415,
    'unsupported_media_type',
    `Upload a PDF, PNG, JPEG or TIFF file${detectedType === undefined ? '' : ` (this file is ${detectedType.mime})`}. ` +
      'Convert Word, PowerPoint and Excel files to PDF first.',
  );
}
