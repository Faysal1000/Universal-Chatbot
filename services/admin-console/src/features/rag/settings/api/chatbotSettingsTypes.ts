/** Chatbot settings shapes from the generated rag contract. */
import type { RagRequestBody, RagResponseBody } from '../../shared/ragContract';

/** A saved settings version (the active one, or any from the history). */
export type ChatbotSettingsVersion = RagResponseBody<'ChatbotSettingsAdminController_describeActive'>;

/** PUT body: every field is required; saving appends a new active version. */
export type ChatbotSettingsSaveRequest = RagRequestBody<'ChatbotSettingsAdminController_save'>;

/** The settings themselves, without the version's note. */
export type ChatbotSettings = Omit<ChatbotSettingsSaveRequest, 'note'>;

export type ReasoningEffort = ChatbotSettingsSaveRequest['reasoningEffort'];

export const REASONING_EFFORTS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
