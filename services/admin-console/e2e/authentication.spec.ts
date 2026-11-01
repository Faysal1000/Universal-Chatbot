import { expect, test } from '@playwright/test';

import { adminCredentials } from './support/credentials';
import { serviceAdminKeys } from './support/platformSecrets';

test.describe('sign-in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('rejects a wrong password, signs in, and signs out again', async ({ page }) => {
    const { username, password } = adminCredentials();
    await page.goto('/rag/documents');
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(`${password}-wrong`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect username or password');

    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Returns to the page that asked for the sign-in.
    await expect(page).toHaveURL(/\/rag\/documents$/);
    const sessionCookie = (await page.context().cookies()).find((cookie) =>
      cookie.name.endsWith('admin_console_session'),
    );
    expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('never exposes a service key to the browser', async ({ page }) => {
    const { username, password } = adminCredentials();
    const responseBodies: string[] = [];
    page.on('response', async (response) => {
      if (response.url().includes('/api/')) responseBodies.push(await response.text().catch(() => ''));
    });
    await page.goto('/login');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();

    await page.goto('/gateway/providers');
    await page.goto('/local-models');
    const everythingTheBrowserSaw = `${await page.content()}${responseBodies.join('')}`;
    for (const serviceKey of serviceAdminKeys()) {
      expect(everythingTheBrowserSaw.includes(serviceKey)).toBe(false);
    }
  });
});
