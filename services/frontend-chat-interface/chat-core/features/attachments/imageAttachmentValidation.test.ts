import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  sniffImageMimeType,
  validateImageFile,
  validateImageMetadata,
} from './imageAttachmentValidation';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

function file(bytes: number[], type: string, name = 'image', padTo = 0): File {
  const data = new Uint8Array(Math.max(bytes.length, padTo));
  data.set(bytes);
  return new File([data], name, { type });
}

describe('validateImageMetadata', () => {
  it('accepts JPEG, PNG and WEBP up to exactly 5 MiB', () => {
    expect(validateImageMetadata({ type: 'image/png', size: 5 * 1024 * 1024 }, 0)).toEqual({ ok: true });
  });

  it('rejects files over 5 MiB, other types, empty files, and too many images', () => {
    expect(validateImageMetadata({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }, 0)).toEqual({
      ok: false,
      reason: 'size',
    });
    expect(validateImageMetadata({ type: 'image/gif', size: 10 }, 0)).toEqual({ ok: false, reason: 'type' });
    expect(validateImageMetadata({ type: 'image/svg+xml', size: 10 }, 0)).toEqual({
      ok: false,
      reason: 'type',
    });
    expect(validateImageMetadata({ type: 'image/png', size: 0 }, 0)).toEqual({
      ok: false,
      reason: 'content',
    });
    expect(validateImageMetadata({ type: 'image/png', size: 10 }, 4)).toEqual({ ok: false, reason: 'count' });
  });
});

describe('sniffImageMimeType', () => {
  it('detects formats from magic bytes', () => {
    expect(sniffImageMimeType(new Uint8Array(PNG_HEADER))).toBe('image/png');
    expect(sniffImageMimeType(new Uint8Array(JPEG_HEADER))).toBe('image/jpeg');
    expect(sniffImageMimeType(new Uint8Array(WEBP_HEADER))).toBe('image/webp');
    expect(sniffImageMimeType(new Uint8Array([0x4d, 0x5a, 0x90, 0]))).toBeNull();
  });
});

describe('validateImageFile', () => {
  it('accepts a real PNG', async () => {
    await expect(validateImageFile(file(PNG_HEADER, 'image/png', 'a.png', 64), 0)).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects a renamed non-image and a type mismatch', async () => {
    await expect(
      validateImageFile(file([0x4d, 0x5a, 0x90, 0], 'image/png', 'evil.png', 64), 0),
    ).resolves.toEqual({ ok: false, reason: 'content' });
    await expect(validateImageFile(file(JPEG_HEADER, 'image/png', 'a.png', 64), 0)).resolves.toEqual({
      ok: false,
      reason: 'content',
    });
  });
});

describe('formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MiB');
  });
});
