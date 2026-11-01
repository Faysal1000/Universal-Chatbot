/**
 * The slice of rag's admin API (`/v1/admin`) the end-to-end tests need to seed the real backend: one fixture
 * document and the chatbot settings (reasoning on or off). Authenticated with RAG_ADMIN_API_KEY, which the
 * caller exports as CHAT_E2E_RAG_ADMIN_API_KEY.
 */
export const RAG_API_URL = process.env.CHAT_DEV_RAG_API_URL ?? 'http://localhost:8080';

const SETTINGS_FIELDS = [
  'botName',
  'greetingMessage',
  'suggestedPrompts',
  'systemInstruction',
  'fallbackMessage',
  'answerOnlyFromDocuments',
  'answerTemperature',
  'maxAnswerTokens',
  'maxSources',
  'minSimilarity',
  'showReasoning',
  'showSources',
  'reasoningEffort',
  'memorySummaryThresholdRatio',
  'memoryRecentTurnCount',
  'maxMessageChars',
  'maxTurnsPerConversation',
] as const;

type SettingsField = (typeof SETTINGS_FIELDS)[number];
export type ChatbotSettings = Record<SettingsField, unknown> & { version: number; showReasoning: boolean };

export interface AdminDocument {
  id: string;
  title: string;
  status: string;
  isEnabled: boolean;
  failure: unknown;
}

function adminApiKey(): string {
  const key = process.env.CHAT_E2E_RAG_ADMIN_API_KEY;
  if (!key) {
    throw new Error(
      'CHAT_E2E_RAG_ADMIN_API_KEY is not set. Export RAG_ADMIN_API_KEY from services/rag/.env under that name.',
    );
  }
  return key;
}

export async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${adminApiKey()}`);
  const response = await fetch(`${RAG_API_URL}/v1/admin${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(
      `rag admin ${init.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function assertRagIsReady(): Promise<void> {
  const response = await fetch(`${RAG_API_URL}/health/ready`).catch((cause: unknown) => {
    throw new Error(`rag is not reachable at ${RAG_API_URL}; start the root stack first`, { cause });
  });
  if (!response.ok) throw new Error(`rag at ${RAG_API_URL} is not ready (${response.status})`);
}

export function getChatbotSettings(): Promise<ChatbotSettings> {
  return adminRequest<ChatbotSettings>('/chatbot-settings');
}

/** Saves a new settings version (rag versions every change) with the given fields changed. */
async function updateChatbotSettings(changes: Partial<Record<SettingsField, unknown>>): Promise<void> {
  const current = await getChatbotSettings();
  const body = Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, changes[field] ?? current[field]]));
  await adminRequest('/chatbot-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * The admin console's switches the tests exercise. "Show reasoning" makes rag stream the model's reasoning
 * before the answer; "show sources" (on by default) controls citations.
 */
export function setChatbotSwitches(switches: {
  showReasoning: boolean;
  showSources: boolean;
}): Promise<void> {
  return updateChatbotSettings({
    showReasoning: switches.showReasoning,
    reasoningEffort: switches.showReasoning ? 'low' : 'off',
    showSources: switches.showSources,
  });
}

/** Defaults for most tests: no reasoning (a small CPU model can spend its whole budget thinking), sources on. */
export function applyDefaultChatbotSwitches(): Promise<void> {
  return setChatbotSwitches({ showReasoning: false, showSources: true });
}

export async function activateChatbotSettingsVersion(version: number): Promise<void> {
  await adminRequest(`/chatbot-settings/versions/${version}/activate`, { method: 'POST' });
}

export async function findDocumentByTitle(title: string): Promise<AdminDocument | undefined> {
  const page = await adminRequest<{ items: AdminDocument[] }>('/documents?limit=100');
  return page.items.find((document) => document.title === title && document.status !== 'failed');
}

export async function uploadDocument(
  title: string,
  fileName: string,
  pdf: Uint8Array<ArrayBuffer>,
): Promise<AdminDocument> {
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), fileName);
  form.append('title', title);
  return adminRequest<AdminDocument>('/documents', { method: 'POST', body: form });
}

export async function waitForDocumentReady(documentId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const document = await adminRequest<AdminDocument>(`/documents/${documentId}`);
    if (document.status === 'ready') return;
    if (document.status === 'failed') {
      throw new Error(`fixture document failed to ingest: ${JSON.stringify(document.failure)}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`fixture document not ready after ${timeoutMs} ms (${document.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
