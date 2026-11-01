import { fileTypeFromBuffer } from 'file-type';
import sharp, { type Sharp } from 'sharp';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { PUBLIC_CHAT_LIMITS } from '../public-chat-limits.js';

/** Refuses images that would decode to more pixels than this (decompression bombs). */
const MAXIMUM_INPUT_PIXELS = 40_000_000;
/** Longest side kept; larger photos are scaled down, which embedding and models do anyway. */
const MAXIMUM_SIDE_PIXELS = 2_048;

// Each image is processed once; libvips' operation cache would only hold memory.
sharp.cache(false);

export interface NormalisedImage {
  readonly bytes: Buffer;
  readonly mimeType: (typeof PUBLIC_CHAT_LIMITS.allowedImageTypes)[number];
  readonly widthPixels: number;
  readonly heightPixels: number;
}

/**
 * Re-encodes a visitor's image: applies the EXIF orientation, drops all metadata (GPS,
 * camera), caps the size and keeps the original format. Anything that is not really a
 * JPEG, PNG or WEBP is refused, whatever its declared type.
 */
export async function normaliseVisitorImage(uploadedBytes: Buffer): Promise<NormalisedImage> {
  const mimeType = await detectAllowedImageType(uploadedBytes);
  try {
    const pipeline = sharp(uploadedBytes, { limitInputPixels: MAXIMUM_INPUT_PIXELS }).rotate().resize({
      width: MAXIMUM_SIDE_PIXELS,
      height: MAXIMUM_SIDE_PIXELS,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const encoded = await encodeAs(pipeline, mimeType).toBuffer({ resolveWithObject: true });
    return {
      bytes: encoded.data,
      mimeType,
      widthPixels: encoded.info.width,
      heightPixels: encoded.info.height,
    };
  } catch {
    throw new ApplicationError(415, 'unsupported_media_type', 'The image could not be read.');
  }
}

async function detectAllowedImageType(bytes: Buffer): Promise<NormalisedImage['mimeType']> {
  const detectedType = await fileTypeFromBuffer(bytes);
  const allowedType = PUBLIC_CHAT_LIMITS.allowedImageTypes.find((type) => type === detectedType?.mime);
  if (allowedType === undefined) {
    throw new ApplicationError(415, 'unsupported_media_type', 'Attach a JPEG, PNG or WEBP image.');
  }
  return allowedType;
}

function encodeAs(pipeline: Sharp, mimeType: NormalisedImage['mimeType']): Sharp {
  switch (mimeType) {
    case 'image/jpeg':
      return pipeline.jpeg({ quality: 85, mozjpeg: true });
    case 'image/png':
      return pipeline.png({ compressionLevel: 9 });
    case 'image/webp':
      return pipeline.webp({ quality: 85 });
  }
}
