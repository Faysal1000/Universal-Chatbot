import { expect, test } from '@playwright/test';

test('adds a website, shows its embed code, then revokes its key', async ({ page }) => {
  const websiteName = `Console e2e site ${Date.now()}`;
  await page.goto('/rag/website-widgets');
  await page.getByRole('button', { name: 'Add a website' }).click();

  const form = page.getByRole('dialog', { name: 'Add a website' });
  await form.getByLabel('Name').fill(websiteName);
  await form.getByLabel('Allowed websites').fill('https://shop.example/\nhttp://localhost:4321');
  await form.getByRole('button', { name: 'Add website' }).click();

  // A new key goes straight to its embed code.
  const embed = page.getByRole('dialog', { name: `Embed code for ${websiteName}` });
  await expect(embed).toBeVisible();
  const code = embed.getByLabel('Embed code');
  await expect(code).toContainText('npm install @faysal1000/universal-chatbot');
  await expect(code).toContainText(/api-key="pk_[A-Za-z0-9_-]+"/);
  await embed.getByRole('radio', { name: 'Script tag' }).check({ force: true });
  await expect(code).toContainText(
    '<script src="https://cdn.jsdelivr.net/npm/@faysal1000/universal-chatbot@0/dist/embed.js" async></script>',
  );
  await page.keyboard.press('Escape');

  const row = page.getByRole('row').filter({ hasText: websiteName });
  await expect(row).toContainText('Active');
  await expect(row).toContainText('https://shop.example');
  await expect(row).toContainText('http://localhost:4321');

  await row.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('dialog', { name: 'Revoke this key?' }).getByRole('button', { name: 'Revoke key' }).click();
  await expect(row).toContainText('Revoked');
  await expect(row.getByRole('button', { name: 'Embed code' })).toHaveCount(0);
});

test('refuses a page address instead of a website origin', async ({ page }) => {
  await page.goto('/rag/website-widgets');
  await page.getByRole('button', { name: 'Add a website' }).click();
  const form = page.getByRole('dialog', { name: 'Add a website' });
  await form.getByLabel('Name').fill('Console e2e invalid origin');
  await form.getByLabel('Allowed websites').fill('https://shop.example/pricing');
  await form.getByRole('button', { name: 'Add website' }).click();
  await expect(form).toContainText('Not a website origin: https://shop.example/pricing');
});
