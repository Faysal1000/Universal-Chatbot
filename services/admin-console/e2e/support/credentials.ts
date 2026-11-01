/** The console's admin sign-in for the tests, read from `.env.e2e`. */
export function adminCredentials(): { username: string; password: string } {
  const username = process.env.ADMIN_CONSOLE_E2E_USERNAME;
  const password = process.env.ADMIN_CONSOLE_E2E_PASSWORD;
  if (!username || !password) {
    throw new Error('Set ADMIN_CONSOLE_E2E_USERNAME and ADMIN_CONSOLE_E2E_PASSWORD (see .env.e2e).');
  }
  return { username, password };
}
