import { randomBytes, scrypt as scryptCallback, type ScryptOptions, timingSafeEqual } from 'node:crypto';

/**
 * scrypt password hashes, self-describing as `scrypt$N$r$p$salt$hash` (Base64 parts), so
 * the cost can be raised later without invalidating stored hashes.
 */
const DEFAULT_COST = { cost: 2 ** 15, blockSize: 8, parallelization: 1 };
const SALT_BYTE_LENGTH = 16;
const KEY_BYTE_LENGTH = 32;
/** scrypt needs 128 × N × r bytes; 64 MiB covers N = 2^15 with headroom. */
const MAXIMUM_MEMORY_BYTES = 64 * 1024 * 1024;
const HASH_PREFIX = 'scrypt';

export class MalformedPasswordHashError extends Error {
  constructor() {
    super('Password hash is not in the scrypt$N$r$p$salt$hash format');
    this.name = 'MalformedPasswordHashError';
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTE_LENGTH);
  const derivedKey = await deriveKey(password, salt, KEY_BYTE_LENGTH, DEFAULT_COST);
  const { cost, blockSize, parallelization } = DEFAULT_COST;
  return [
    HASH_PREFIX,
    cost,
    blockSize,
    parallelization,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parsedHash = parsePasswordHash(encodedHash);
  const derivedKey = await deriveKey(password, parsedHash.salt, parsedHash.key.length, parsedHash);
  return timingSafeEqual(derivedKey, parsedHash.key);
}

function parsePasswordHash(encodedHash: string) {
  const [prefix, costText, blockSizeText, parallelizationText, saltText, keyText] = encodedHash.split('$');
  if (prefix !== HASH_PREFIX || saltText === undefined || keyText === undefined) {
    throw new MalformedPasswordHashError();
  }
  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(parallelizationText);
  if (![cost, blockSize, parallelization].every((value) => Number.isInteger(value) && value > 0)) {
    throw new MalformedPasswordHashError();
  }
  return {
    cost,
    blockSize,
    parallelization,
    salt: Buffer.from(saltText, 'base64'),
    key: Buffer.from(keyText, 'base64'),
  };
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  parameters: { cost: number; blockSize: number; parallelization: number },
): Promise<Buffer> {
  const options: ScryptOptions = {
    N: parameters.cost,
    r: parameters.blockSize,
    p: parameters.parallelization,
    maxmem: MAXIMUM_MEMORY_BYTES,
  };
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, keyLength, options, (error, derivedKey) => {
      if (error === null) resolve(derivedKey);
      else reject(error);
    });
  });
}
