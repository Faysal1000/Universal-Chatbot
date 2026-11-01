import { expect, test } from '@playwright/test';

import { ConsoleApi } from './support/consoleApi';

const TASK_NAME = 'e2e_console_chain';

interface ProviderView {
  is_enabled: boolean;
  models: { id: number; qualified_name: string; is_enabled: boolean; capabilities?: string[] }[];
}

interface RouteView {
  steps: { model_pk: number; max_attempts: number | null }[];
}

test('reorders a model chain with the keyboard, saves it, and it survives a reload', async ({ page, request }) => {
  const api = new ConsoleApi(request);
  const models = (await api.get<ProviderView[]>('/llm-gateway/providers'))
    .filter((provider) => provider.is_enabled)
    .flatMap((provider) => provider.models)
    .filter((model) => model.is_enabled);
  const [firstModel, secondModel] = models;
  test.skip(firstModel === undefined || secondModel === undefined, 'needs two enabled models in the gateway');
  if (!firstModel || !secondModel) return;

  await request.fetch(`/api/llm-gateway/routes/${TASK_NAME}`, { method: 'DELETE', headers: await csrf(api) });
  await api.send('POST', '/llm-gateway/routes', {
    task_name: TASK_NAME,
    description: 'Created by the admin console e2e test',
    is_enabled: true,
    steps: [{ model_pk: firstModel.id }, { model_pk: secondModel.id }],
    append_default_model: false,
  });

  try {
    await page.goto('/gateway/routing');
    const row = page.getByRole('row').filter({ hasText: TASK_NAME });
    await row.getByRole('button', { name: 'Edit chain' }).click();
    const editor = page.getByRole('form', { name: `Edit route ${TASK_NAME}` });
    await expect(editor.getByText('Step 2', { exact: true })).toBeVisible();

    // Keyboard drag and drop: lift step 2, move it up, drop it.
    // Each key waits for dnd-kit to settle (lifted handle, then the announcements), as it measures between keys.
    const secondStepHandle = editor.getByRole('button', { name: 'Reorder step 2' });
    await secondStepHandle.focus();
    await page.keyboard.press('Space');
    await expect(secondStepHandle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByText(/is over position 1 of 2\.$/)).toBeAttached();
    await page.keyboard.press('Space');
    await expect(page.getByText(/dropped at position 1 of 2\.$/)).toBeAttached();
    await expect(editor.getByLabel('Step 1 model')).toHaveValue(String(secondModel.id));

    await editor.getByLabel('Step 1 attempts').fill('2');
    await editor.getByRole('button', { name: 'Save chain' }).click();
    await expect(editor).toBeHidden();

    await page.reload();
    await page.getByRole('row').filter({ hasText: TASK_NAME }).getByRole('button', { name: 'Edit chain' }).click();
    const reopened = page.getByRole('form', { name: `Edit route ${TASK_NAME}` });
    await expect(reopened.getByLabel('Step 1 model')).toHaveValue(String(secondModel.id));
    await expect(reopened.getByLabel('Step 2 model')).toHaveValue(String(firstModel.id));
    await expect(reopened.getByLabel('Step 1 attempts')).toHaveValue('2');

    const saved = await api.get<RouteView>(`/llm-gateway/routes/${TASK_NAME}/chain`);
    expect(saved.steps.map((step) => [step.model_pk, step.max_attempts])).toEqual([
      [secondModel.id, 2],
      [firstModel.id, 1],
    ]);
  } finally {
    await api.send('DELETE', `/llm-gateway/routes/${TASK_NAME}`);
  }
});

async function csrf(api: ConsoleApi): Promise<Record<string, string>> {
  const session = await api.get<{ csrfToken: string }>('/session');
  return { 'x-csrf-token': session.csrfToken };
}
