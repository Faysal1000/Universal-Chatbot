import {
  activateChatbotSettingsVersion,
  ALLOWED_DEMO_ORIGIN,
  assertRagIsReady,
  buildFixturePdf,
  findDocumentByTitle,
  FIXTURE_DOCUMENT_TITLE,
  FIXTURE_FILE_NAME,
  getChatbotSettings,
  uploadDocument,
  waitForDocumentReady,
} from './support/stack';
import { ensureWidgetKey } from './support/widgetKeys';

const INGESTION_TIMEOUT_MS = 5 * 60_000;
export const E2E_WIDGET_KEY_NAME = 'Chat widget e2e: demo pages';

/**
 * Prepares the real backend: rag is up, the fixture document is ingested, and a widget key allows the demo
 * pages' origin. The key reaches the tests through the environment; the teardown restores the chatbot settings
 * the tests switched.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await assertRagIsReady();
  const originalSettingsVersion = (await getChatbotSettings()).version;
  const document =
    (await findDocumentByTitle(FIXTURE_DOCUMENT_TITLE)) ??
    (await uploadDocument(FIXTURE_DOCUMENT_TITLE, FIXTURE_FILE_NAME, buildFixturePdf()));
  await waitForDocumentReady(document.id, INGESTION_TIMEOUT_MS);
  const widgetKey = await ensureWidgetKey(E2E_WIDGET_KEY_NAME, [ALLOWED_DEMO_ORIGIN]);
  process.env.CHAT_WIDGET_E2E_KEY = widgetKey.publishableKey;
  return () => activateChatbotSettingsVersion(originalSettingsVersion);
}
