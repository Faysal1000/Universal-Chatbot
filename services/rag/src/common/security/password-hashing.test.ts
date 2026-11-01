import { describe, expect, it } from 'vitest';

import { hashPassword, MalformedPasswordHashError, verifyPassword } from './password-hashing.js';

describe('password hashing', () => {
  it('verifies the original password and rejects any other', async () => {
    const encodedHash = await hashPassword('correct horse battery staple');

    expect(encodedHash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    await expect(verifyPassword('correct horse battery staple', encodedHash)).resolves.toBe(true);
    await expect(verifyPassword('correct horse battery stapl', encodedHash)).resolves.toBe(false);
  });

  it('salts every hash, so equal passwords produce different hashes', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('treats Unicode-equivalent passwords as equal (NFKC)', async () => {
    const encodedHash = await hashPassword('ｐａｓｓｗｏｒｄ');

    await expect(verifyPassword('password', encodedHash)).resolves.toBe(true);
  });

  it('rejects a hash in an unknown format', async () => {
    await expect(verifyPassword('anything', 'bcrypt$12$abc')).rejects.toBeInstanceOf(
      MalformedPasswordHashError,
    );
  });
});
