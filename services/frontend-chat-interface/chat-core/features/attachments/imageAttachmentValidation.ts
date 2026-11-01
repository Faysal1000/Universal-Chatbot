import type { ChatLimits } from '@chat-core/api/chatApiContract';

export type ImageRejectionReason = 'type' | 'size' | 'count' | 'content';

export type ImageValidationResult = { ok: true } | { ok: false; reason: ImageRejectionReason };

export type ImageLimits = Pick<ChatLimits, 'maxImageBytes' | 'allowedImageTypes' | 'maxImagesPerTurn'>;

/** Defaults match embedding-server's image limits; the backend's `/config` limits override them. */
export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxImageBytes: 5 * 1024 * 1024,
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxImagesPerTurn: 4,
};

/** Synchronous checks on metadata: declared MIME type, size, and how many images are already attached. */
export function validateImageMetadata(
  file: Pick<File, 'type' | 'size'>,
  alreadyAttached: number,
  limits: ImageLimits = DEFAULT_IMAGE_LIMITS,
): ImageValidationResult {
  if (alreadyAttached >= limits.maxImagesPerTurn) return { ok: false, reason: 'count' };
  if (!limits.allowedImageTypes.includes(file.type)) return { ok: false, reason: 'type' };
  if (file.size > limits.maxImageBytes) return { ok: false, reason: 'size' };
  if (file.size === 0) return { ok: false, reason: 'content' };
  return { ok: true };
}

/** Detects the real image format from magic bytes, so a renamed `.exe` → `.png` is rejected before upload. */
export function sniffImageMimeType(header: Uint8Array): string | null {
  const startsWith = (bytes: number[], offset = 0) =>
    bytes.every((byte, index) => header[offset + index] === byte);
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Full validation: metadata checks, then content sniffing that must agree with the declared type. */
export async function validateImageFile(
  file: File,
  alreadyAttached: number,
  limits?: ImageLimits,
): Promise<ImageValidationResult> {
  const metadata = validateImageMetadata(file, alreadyAttached, limits);
  if (!metadata.ok) return metadata;
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return sniffImageMimeType(header) === file.type ? { ok: true } : { ok: false, reason: 'content' };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MiB`;
}
