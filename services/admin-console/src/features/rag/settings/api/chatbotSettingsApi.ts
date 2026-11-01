import { requestRagApi } from '@/shared/api/httpClient';

import type { ChatbotSettingsSaveRequest, ChatbotSettingsVersion } from './chatbotSettingsTypes';

export function getActiveChatbotSettings(): Promise<ChatbotSettingsVersion> {
  return requestRagApi<ChatbotSettingsVersion>('/chatbot-settings');
}

/** Saves a new version and makes it active; earlier versions stay listed. */
export function saveChatbotSettings(request: ChatbotSettingsSaveRequest): Promise<ChatbotSettingsVersion> {
  return requestRagApi<ChatbotSettingsVersion>('/chatbot-settings', { method: 'PUT', body: request });
}

/** Newest first (rag returns the latest 100). */
export function listChatbotSettingsVersions(): Promise<ChatbotSettingsVersion[]> {
  return requestRagApi<ChatbotSettingsVersion[]>('/chatbot-settings/versions');
}

export function activateChatbotSettingsVersion(version: number): Promise<ChatbotSettingsVersion> {
  return requestRagApi<ChatbotSettingsVersion>(`/chatbot-settings/versions/${version}/activate`, { method: 'POST' });
}
