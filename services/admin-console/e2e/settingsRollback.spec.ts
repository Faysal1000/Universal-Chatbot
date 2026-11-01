import { expect, test } from '@playwright/test';

test('changes a chatbot setting, then rolls back to the previous version', async ({ page }) => {
  await page.goto('/rag/settings');

  const showSources = page.getByRole('switch', { name: 'Show sources' });
  await expect(showSources).toBeVisible();
  const wasOn = (await showSources.getAttribute('aria-checked')) === 'true';
  const activeRow = page.getByRole('row').filter({ hasText: 'Active' });
  const previousVersion = (await activeRow.getByText(/^Version \d+$/).textContent())?.trim() ?? '';
  expect(previousVersion).toMatch(/^Version \d+$/);

  const versionNote = `Console e2e ${Date.now()}`;
  await showSources.click();
  await page.getByLabel('Note for this version').fill(versionNote);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(showSources).toHaveAttribute('aria-checked', String(!wasOn));
  const savedRow = page.getByRole('row').filter({ hasText: 'Active' });
  await expect(savedRow.getByText(previousVersion, { exact: true })).toHaveCount(0);
  await expect(savedRow).toContainText(versionNote);

  // The history lists the newest versions first; an older one is behind "Show all".
  const showAllVersions = page.getByRole('button', { name: /^Show all \d+ versions$/ });
  if (await showAllVersions.isVisible()) await showAllVersions.click();
  const previousRow = page.getByRole('row').filter({ has: page.getByText(previousVersion, { exact: true }) });
  await previousRow.getByRole('button', { name: 'Activate' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: `Activate ${previousVersion.toLowerCase()}` })
    .click();

  await expect(
    page.getByRole('row').filter({ hasText: 'Active' }).getByText(previousVersion, { exact: true }),
  ).toBeVisible();
  await expect(showSources).toHaveAttribute('aria-checked', String(wasOn));
});
