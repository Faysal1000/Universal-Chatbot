import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api/httpClient';

import { describeUploadRejection, isAcceptedUploadFile, uploadPercent } from './uploadModel';

describe('isAcceptedUploadFile', () => {
  it.each([
    ['handbook.PDF', ''],
    ['scan.tiff', ''],
    ['photo', 'image/jpeg'],
  ])('accepts %s (%s)', (name, type) => {
    expect(isAcceptedUploadFile({ name, type })).toBe(true);
  });

  it.each([
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['slides.pptx', ''],
    ['notes.txt', 'text/plain'],
  ])('refuses %s before uploading', (name, type) => {
    expect(isAcceptedUploadFile({ name, type })).toBe(false);
  });
});

describe('describeUploadRejection', () => {
  it('explains a duplicate upload', () => {
    const duplicate = new ApiError(409, 'Conflict: This file has already been uploaded.', {
      code: 'duplicate_document',
      details: { existingDocumentId: 'd1' },
    });
    const rejection = describeUploadRejection(duplicate);
    expect(rejection.title).toBe('Already uploaded');
    expect(rejection.message).toContain('This file has already been uploaded.');
    expect(rejection.message).toContain('SHA-256');
    expect(rejection.existingDocumentPath).toBe('/rag/documents/d1');
  });

  it('explains a duplicate without a link when rag names no document', () => {
    const duplicate = new ApiError(409, 'Conflict: This file has already been uploaded.', {
      code: 'duplicate_document',
    });
    expect(describeUploadRejection(duplicate).existingDocumentPath).toBeUndefined();
  });

  it('passes on rag’s message for unsupported types', () => {
    const unsupported = new ApiError(415, 'Unsupported Media Type: Upload a PDF, PNG, JPEG or TIFF file.', {
      code: 'unsupported_media_type',
    });
    expect(describeUploadRejection(unsupported)).toEqual({
      title: 'Unsupported file type',
      message: 'Unsupported Media Type: Upload a PDF, PNG, JPEG or TIFF file.',
    });
  });

  it('falls back to the error message', () => {
    expect(describeUploadRejection(new Error('offline'))).toEqual({ title: 'Upload failed', message: 'offline' });
  });
});

describe('uploadPercent', () => {
  it('rounds to whole percent and handles an unknown size', () => {
    expect(uploadPercent(1, 3)).toBe(33);
    expect(uploadPercent(5, 0)).toBe(0);
    expect(uploadPercent(10, 10)).toBe(100);
  });
});
