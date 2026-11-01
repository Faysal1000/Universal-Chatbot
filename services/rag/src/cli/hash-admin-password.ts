/**
 * Prints a scrypt hash for RAG_ADMIN_BOOTSTRAP_PASSWORD_HASH. The password is read from
 * standard input so it never appears in shell history or the process list:
 *
 *   printf '%s' 'the password' | npm run -s admin:hash-password
 *   docker run --rm -i rag:local node dist/cli/hash-admin-password.js < password.txt
 */
import { text } from 'node:stream/consumers';

import { hashPassword } from '../common/security/password-hashing.js';

const MINIMUM_PASSWORD_LENGTH = 12;

const password = (await text(process.stdin)).replace(/\r?\n$/, '');
if (password.length < MINIMUM_PASSWORD_LENGTH) {
  process.stderr.write(`The password must be at least ${MINIMUM_PASSWORD_LENGTH} characters long.\n`);
  process.exit(1);
}
process.stdout.write(`${await hashPassword(password)}\n`);
