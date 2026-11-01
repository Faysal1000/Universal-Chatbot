/**
 * Prints the scrypt hash for ADMIN_CONSOLE_ADMIN_PASSWORD_HASH. Reads the password from stdin
 * so it never lands in shell history:  `npm run hash-password` (or pipe it in).
 */
import { createInterface } from 'node:readline/promises';

import { hashPassword } from '../security/passwordHash.ts';

const MINIMUM_PASSWORD_LENGTH = 12;

async function readPassword(): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  if (process.stdin.isTTY) process.stderr.write('Admin password: ');
  for await (const line of reader) {
    reader.close();
    return line;
  }
  return '';
}

const password = await readPassword();
if (password.length < MINIMUM_PASSWORD_LENGTH) {
  process.stderr.write(`The password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.\n`);
  process.exit(1);
}
process.stdout.write(`ADMIN_CONSOLE_ADMIN_PASSWORD_HASH=${await hashPassword(password)}\n`);
