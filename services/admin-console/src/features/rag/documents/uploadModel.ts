/** Pure rules for document uploads: which files to send and how rag's refusals read. */
import { ApiError, describeError } from '@/shared/api/httpClient';
import { documentPath } from '@/shared/routePaths';

/** File extensions rag accepts (it checks the bytes, not the name; this only stops obvious mistakes early). */
const ACCEPTED_FILE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff'] as const;
const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'] as const;

/** Value for the file input's `accept` attribute. */
export const UPLOAD_ACCEPT_ATTRIBUTE = [...ACCEPTED_FILE_EXTENSIONS, ...ACCEPTED_MIME_TYPES].join(',');

export const UNSUPPORTED_FILE_MESSAGE =
  'Not uploaded: rag accepts PDF, PNG, JPEG and TIFF only. Convert Word, PowerPoint and Excel files to PDF first.';

const DUPLICATE_DOCUMENT_CODE = 'duplicate_document';
const UNSUPPORTED_MEDIA_TYPE_STATUS = 415;

export function isAcceptedUploadFile(file: Pick<File, 'name' | 'type'>): boolean {
  const lowerCaseName = file.name.toLowerCase();
  const hasAcceptedExtension = ACCEPTED_FILE_EXTENSIONS.some((extension) => lowerCaseName.endsWith(extension));
  const hasAcceptedMimeType = (ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type);
  return hasAcceptedExtension || hasAcceptedMimeType;
}

export interface UploadRejection {
  title: string;
  message: string;
  /** For a duplicate: the console page of the document already holding this file. */
  existingDocumentPath?: string;
}

/** How a failed upload reads: duplicates and unsupported types get their own headline. */
export function describeUploadRejection(error: unknown): UploadRejection {
  if (error instanceof ApiError && error.code === DUPLICATE_DOCUMENT_CODE) {
    const existingDocumentId = readExistingDocumentId(error.details);
    return {
      title: 'Already uploaded',
      message: `${error.message} rag keeps one copy of identical files (matched by SHA-256).`,
      ...(existingDocumentId ? { existingDocumentPath: documentPath(existingDocumentId) } : {}),
    };
  }
  if (error instanceof ApiError && error.httpStatus === UNSUPPORTED_MEDIA_TYPE_STATUS) {
    return { title: 'Unsupported file type', message: error.message };
  }
  return { title: 'Upload failed', message: describeError(error) };
}

/** `details.existingDocumentId` of rag's `duplicate_document` problem, when present. */
function readExistingDocumentId(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const { existingDocumentId } = details as Record<string, unknown>;
  return typeof existingDocumentId === 'string' ? existingDocumentId : undefined;
}

/** Whole-number upload percentage; 0 before the size is known. */
export function uploadPercent(loadedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
}
