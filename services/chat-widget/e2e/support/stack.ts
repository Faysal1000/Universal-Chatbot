/**
 * The real platform the widget's end-to-end tests run against, reached the way the chat app's tests reach it:
 * rag's admin API with RAG_ADMIN_API_KEY (exported as CHAT_E2E_RAG_ADMIN_API_KEY), and the same fixture
 * document. Seeding helpers are shared with services/frontend-chat-interface/e2e rather than copied.
 */
export {
  activateChatbotSettingsVersion,
  adminRequest,
  applyDefaultChatbotSwitches,
  assertRagIsReady,
  findDocumentByTitle,
  getChatbotSettings,
  setChatbotSwitches,
  uploadDocument,
  waitForDocumentReady,
} from '../../../frontend-chat-interface/e2e/support/ragAdminApi';
export {
  buildFixturePdf,
  FIXTURE_DOCUMENT_TITLE,
  FIXTURE_FILE_NAME,
  FIXTURE_QUESTION,
} from '../../../frontend-chat-interface/e2e/support/fixtureDocument';

/** The demo pages' port in the tests (5391 stays free for `npm run demo`). */
export const DEMO_PORT = 5392;
/** The origin the test key allows. */
export const ALLOWED_DEMO_ORIGIN = `http://localhost:${DEMO_PORT}`;
/** The same pages on an origin no key lists. */
export const FOREIGN_DEMO_ORIGIN = `http://127.0.0.1:${DEMO_PORT}`;
