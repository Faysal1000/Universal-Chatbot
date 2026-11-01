import { expect, test } from '@playwright/test';

import { ConsoleApi } from './support/consoleApi';
import { adminCredentials } from './support/credentials';
import { buildSamplePdf } from './support/samplePdf';

const INGESTION_TIMEOUT_MILLISECONDS = 4 * 60_000;

interface DocumentList {
  items: { id: string; originalFilename?: string; title?: string | null }[];
}

interface AuditEventPage {
  items: { action: string; actorUsername: string | null }[];
}

test('uploads a PDF, follows its ingestion to ready, and opens its pages', async ({ page, request }) => {
  const marker = `${Date.now()}`;
  const fileName = `console-e2e-${marker}.pdf`;
  await page.goto('/rag/documents');

  const pdfBytes = buildSamplePdf(marker);
  await page
    .getByLabel('Upload documents')
    .setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: pdfBytes });

  const progress = page.getByRole('status', { name: 'Upload progress' });
  await expect(progress.getByRole('progressbar').first()).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: fileName });
  await expect(row.getByText('Ready')).toBeVisible({ timeout: INGESTION_TIMEOUT_MILLISECONDS });

  // The same bytes again: rag refuses the copy and the console links to the document it already has.
  await page.goto('/rag/documents');
  await page.getByLabel('Upload documents').setInputFiles({
    name: `copy-of-${fileName}`,
    mimeType: 'application/pdf',
    buffer: pdfBytes,
  });
  await expect(progress.getByText('Already uploaded')).toBeVisible();
  await progress.getByRole('link', { name: 'Open the existing document' }).click();
  await expect(page.getByText(`Marker ${marker}`).first()).toBeVisible();

  const api = new ConsoleApi(request);
  const documents = await api.get<DocumentList>(`/rag/documents?search=${encodeURIComponent(marker)}`);
  const [uploadedDocument] = documents.items;
  expect(uploadedDocument).toBeDefined();
  if (!uploadedDocument) return;
  const auditEvents = await api.get<AuditEventPage>(`/rag/audit-events?targetId=${uploadedDocument.id}`);
  expect(auditEvents.items.find((event) => event.action === 'document.uploaded')?.actorUsername).toBe(
    adminCredentials().username,
  );
  for (const document of documents.items) await api.send('DELETE', `/rag/documents/${document.id}`);
});
