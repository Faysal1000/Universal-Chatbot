import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTE_LENGTH = 32;

/** 256-bit random token, URL-safe Base64 without padding. */
export function generateSecureToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
}

export function sha256Hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

export function hmacSha256Hex(secret: string, text: string): string {
  return createHmac('sha256', secret).update(text).digest('hex');
}

/** Constant-time comparison; differing lengths return false without leaking timing. */
export function areEqualInConstantTime(first: string, second: string): boolean {
  const firstDigest = createHash('sha256').update(first).digest();
  const secondDigest = createHash('sha256').update(second).digest();
  return timingSafeEqual(firstDigest, secondDigest) && first.length === second.length;
}
