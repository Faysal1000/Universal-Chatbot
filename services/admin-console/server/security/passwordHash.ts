/**
 * Admin password hashing with scrypt (Node's built-in, memory-hard KDF).
 * Format: `scrypt:<N>:<r>:<p>:<salt base64>:<hash base64>`, so parameters can be raised later
 * without invalidating existing hashes. No `$`, so the hash survives Compose and shell interpolation.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const SCHEME = 'scrypt';
const DEFAULT_COST = { N: 2 ** 15, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEMORY_BYTES = 128 * 1024 * 1024;
const HASH_PATTERN = /^scrypt:(\d+):(\d+):(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { ...options, maxmem: MAX_MEMORY_BYTES }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function isPasswordHash(candidate: string): boolean {
  return HASH_PATTERN.test(candidate);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await scrypt(password, salt, KEY_BYTES, DEFAULT_COST);
  const { N, r, p } = DEFAULT_COST;
  return [SCHEME, N, r, p, salt.toString('base64'), derivedKey.toString('base64')].join(':');
}

/** Constant-time check; a malformed hash never matches. */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const match = HASH_PATTERN.exec(passwordHash);
  if (!match) return false;
  const [, cost, blockSize, parallelization, saltBase64, keyBase64] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expectedKey = Buffer.from(keyBase64, 'base64');
  const derivedKey = await scrypt(password, Buffer.from(saltBase64, 'base64'), expectedKey.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelization),
  });
  return timingSafeEqual(derivedKey, expectedKey);
}
