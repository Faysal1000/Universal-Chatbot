/**
 * Signs in once through the real login form and saves the session for every test, so the
 * login throttle is never hit by the suite itself.
 */
import { chromium, type FullConfig } from '@playwright/test';

import { adminCredentials } from './credentials';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('baseURL is not configured');
  const { username, password } = adminCredentials();
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Platform overview' }).waitFor();
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
  await browser.close();
}
