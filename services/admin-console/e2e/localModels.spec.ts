import { expect, test, type Page } from '@playwright/test';

const CHAT_DEPLOYMENT = 'qwen3.5-0.8b';
const SYSTEM_DEPLOYMENT = 'nemotron-parse';
const LOAD_TIMEOUT_MILLISECONDS = 4 * 60_000;

test('unloads and reloads a local model; the system deployment cannot be removed', async ({ page }) => {
  await page.goto('/local-models');

  const systemRow = page.getByRole('row').filter({ hasText: SYSTEM_DEPLOYMENT });
  await expect(systemRow.getByText('System · required by RAG')).toBeVisible();
  await expect(systemRow.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(systemRow.getByRole('button', { name: 'Unload' })).toHaveCount(0);

  const chatRow = page.getByRole('row').filter({ hasText: CHAT_DEPLOYMENT });
  await expect(chatRow.getByText('Ready')).toBeVisible();

  await chatRow.getByRole('button', { name: 'Unload' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Unload/ })
    .click();
  await expect(chatRow.getByText('Unloaded')).toBeVisible({ timeout: 60_000 });

  await chatRow.getByRole('button', { name: 'Load' }).click();
  await expect(chatRow.getByText(/Loading|Downloading/)).toBeVisible();
  await expect(chatRow.getByText('Ready')).toBeVisible({ timeout: LOAD_TIMEOUT_MILLISECONDS });
});

test('refuses a deployment whose name is taken, on the name field', async ({ page }) => {
  await page.goto('/local-models');
  await page.getByRole('button', { name: 'Deploy model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Deploy model' });
  await dialog.getByLabel('Name', { exact: true }).fill(CHAT_DEPLOYMENT);
  await dialog.getByLabel('Hugging Face model id').fill('unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M');
  await dialog.getByRole('button', { name: 'Deploy model' }).click();

  await expect(dialog.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(
    dialog.getByText(`A deployment named '${CHAT_DEPLOYMENT}' already exists. Choose another name.`),
  ).toBeVisible();
});

test('changes the reasoning control without reloading the model, then restores it', async ({ page }) => {
  await page.goto('/local-models');
  const chatRow = page.getByRole('row').filter({ hasText: CHAT_DEPLOYMENT });
  await expect(chatRow.getByText('Ready')).toBeVisible();
  const reasoningSetting = chatRow.getByRole('definition').last();

  await setReasoningControl(page, 'Reasoning effort');
  await expect(reasoningSetting).toContainText('reasoning effort');
  await expect(chatRow.getByText('Ready')).toBeVisible();

  await setReasoningControl(page, 'Auto (detect from the chat template)');
  await expect(reasoningSetting).toHaveText(/^Auto/);
});

async function setReasoningControl(page: Page, optionLabel: string): Promise<void> {
  await page.getByRole('row').filter({ hasText: CHAT_DEPLOYMENT }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: `Edit “${CHAT_DEPLOYMENT}”` });
  await dialog.getByLabel('Reasoning control').selectOption({ label: optionLabel });
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(dialog).toBeHidden();
}
