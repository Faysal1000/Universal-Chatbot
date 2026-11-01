import { buildFixturePdf, FIXTURE_DOCUMENT_TITLE, FIXTURE_FILE_NAME } from './support/fixtureDocument';
import {
  activateChatbotSettingsVersion,
  assertRagIsReady,
  findDocumentByTitle,
  getChatbotSettings,
  RAG_API_URL,
  uploadDocument,
  waitForDocumentReady,
} from './support/ragAdminApi';
import { startStreamCuttingProxy } from './support/streamCuttingProxy';

const INGESTION_TIMEOUT_MS = 5 * 60_000;

/**
 * Prepares the real rag backend: checks it is up, makes sure the fixture document is ingested, starts the
 * stream-cutting proxy Vite talks through, and remembers the active chatbot settings so the returned teardown
 * can restore them after tests changed them.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await assertRagIsReady();
  const originalSettingsVersion = (await getChatbotSettings()).version;

  const existing = await findDocumentByTitle(FIXTURE_DOCUMENT_TITLE);
  const document =
    existing ?? (await uploadDocument(FIXTURE_DOCUMENT_TITLE, FIXTURE_FILE_NAME, buildFixturePdf()));
  await waitForDocumentReady(document.id, INGESTION_TIMEOUT_MS);

  const proxy = await startStreamCuttingProxy(RAG_API_URL);
  return async () => {
    proxy.close();
    await activateChatbotSettingsVersion(originalSettingsVersion);
  };
}
