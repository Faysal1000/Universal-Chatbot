/**
 * The chatbot settings form: loading a saved version into editable values, checking them
 * against rag's limits (`chatbot-settings.schemas.ts`), building the full PUT body, and
 * listing what a save (or an activation) would change.
 */
import type { FieldErrorMessages } from '@/shared/lib/fieldErrors';
import { formatInteger } from '@/shared/lib/format';
import { parseOptionalNumber } from '@/shared/lib/numberInput';

import type {
  ChatbotSettings,
  ChatbotSettingsSaveRequest,
  ChatbotSettingsVersion,
  ReasoningEffort,
} from './api/chatbotSettingsTypes';

export type SettingName = keyof ChatbotSettings;

type TextSettingName = 'botName' | 'greetingMessage' | 'systemInstruction' | 'fallbackMessage';
type NumericSettingName =
  | 'answerTemperature'
  | 'maxAnswerTokens'
  | 'maxSources'
  | 'minSimilarity'
  | 'memorySummaryThresholdRatio'
  | 'memoryRecentTurnCount'
  | 'maxMessageChars'
  | 'maxTurnsPerConversation';

/** Editable values: numbers stay text while typing, prompts are one input each. */
export type ChatbotSettingsFormValues = Record<TextSettingName | NumericSettingName, string> & {
  suggestedPrompts: string[];
  answerOnlyFromDocuments: boolean;
  showReasoning: boolean;
  showSources: boolean;
  reasoningEffort: ReasoningEffort;
};

export const TEXT_SETTING_LIMITS: Record<TextSettingName, { maximumLength: number }> = {
  botName: { maximumLength: 80 },
  greetingMessage: { maximumLength: 1_000 },
  systemInstruction: { maximumLength: 8_000 },
  fallbackMessage: { maximumLength: 1_000 },
};

export interface NumericSettingLimits {
  minimum: number;
  maximum: number;
  isInteger: boolean;
}

export const NUMERIC_SETTING_LIMITS: Record<NumericSettingName, NumericSettingLimits> = {
  answerTemperature: { minimum: 0, maximum: 2, isInteger: false },
  maxAnswerTokens: { minimum: 64, maximum: 32_768, isInteger: true },
  maxSources: { minimum: 1, maximum: 20, isInteger: true },
  minSimilarity: { minimum: 0, maximum: 1, isInteger: false },
  memorySummaryThresholdRatio: { minimum: 0.1, maximum: 0.95, isInteger: false },
  memoryRecentTurnCount: { minimum: 1, maximum: 50, isInteger: true },
  maxMessageChars: { minimum: 50, maximum: 8_000, isInteger: true },
  maxTurnsPerConversation: { minimum: 1, maximum: 10_000, isInteger: true },
};

export const MAXIMUM_SUGGESTED_PROMPTS = 6;
export const MAXIMUM_SUGGESTED_PROMPT_LENGTH = 200;
/** Why a version was saved; shown in the version history. */
export const MAXIMUM_VERSION_NOTE_LENGTH = 500;

/** Labels shared by the form and the change summary. */
export const SETTING_LABELS: Record<SettingName, string> = {
  botName: 'Bot name',
  greetingMessage: 'Greeting message',
  suggestedPrompts: 'Suggested prompts',
  systemInstruction: 'System instruction',
  fallbackMessage: 'Fallback message',
  answerOnlyFromDocuments: 'Answer only from documents',
  answerTemperature: 'Answer temperature',
  maxAnswerTokens: 'Maximum answer tokens',
  maxSources: 'Maximum sources',
  minSimilarity: 'Minimum similarity',
  showReasoning: 'Show reasoning',
  showSources: 'Show sources',
  reasoningEffort: 'Reasoning effort',
  memorySummaryThresholdRatio: 'Summary threshold',
  memoryRecentTurnCount: 'Recent turns kept verbatim',
  maxMessageChars: 'Maximum message length',
  maxTurnsPerConversation: 'Maximum turns per conversation',
};

/** The order fields are listed in the change summary (the form's section order). */
const SETTING_ORDER: readonly SettingName[] = [
  'botName',
  'greetingMessage',
  'suggestedPrompts',
  'systemInstruction',
  'fallbackMessage',
  'answerOnlyFromDocuments',
  'answerTemperature',
  'maxAnswerTokens',
  'reasoningEffort',
  'showReasoning',
  'showSources',
  'minSimilarity',
  'maxSources',
  'memorySummaryThresholdRatio',
  'memoryRecentTurnCount',
  'maxMessageChars',
  'maxTurnsPerConversation',
];

export function formValuesFromSettings(settings: ChatbotSettings): ChatbotSettingsFormValues {
  return {
    botName: settings.botName,
    greetingMessage: settings.greetingMessage,
    suggestedPrompts: [...settings.suggestedPrompts],
    systemInstruction: settings.systemInstruction,
    fallbackMessage: settings.fallbackMessage,
    answerOnlyFromDocuments: settings.answerOnlyFromDocuments,
    answerTemperature: String(settings.answerTemperature),
    maxAnswerTokens: String(settings.maxAnswerTokens),
    maxSources: String(settings.maxSources),
    minSimilarity: String(settings.minSimilarity),
    showReasoning: settings.showReasoning,
    showSources: settings.showSources,
    reasoningEffort: settings.reasoningEffort,
    memorySummaryThresholdRatio: String(settings.memorySummaryThresholdRatio),
    memoryRecentTurnCount: String(settings.memoryRecentTurnCount),
    maxMessageChars: String(settings.maxMessageChars),
    maxTurnsPerConversation: String(settings.maxTurnsPerConversation),
  };
}

/** Field name → message for every value rag would refuse. Empty prompt rows are ignored (dropped on save). */
export function validateSettingsForm(values: ChatbotSettingsFormValues): FieldErrorMessages {
  const fieldErrors: FieldErrorMessages = {};
  for (const [settingName, limits] of Object.entries(TEXT_SETTING_LIMITS) as [
    TextSettingName,
    { maximumLength: number },
  ][]) {
    const message = textErrorMessage(values[settingName], limits.maximumLength);
    if (message) fieldErrors[settingName] = message;
  }
  for (const [settingName, limits] of Object.entries(NUMERIC_SETTING_LIMITS) as [
    NumericSettingName,
    NumericSettingLimits,
  ][]) {
    const message = numericErrorMessage(values[settingName], limits);
    if (message) fieldErrors[settingName] = message;
  }
  const promptsMessage = suggestedPromptsErrorMessage(values.suggestedPrompts);
  if (promptsMessage) fieldErrors.suggestedPrompts = promptsMessage;
  return fieldErrors;
}

/** The full PUT body (rag requires every setting); call only when validation passed. */
export function toSaveRequest(values: ChatbotSettingsFormValues, note: string): ChatbotSettingsSaveRequest {
  return { ...toSettings(values), note: note.trim() || null };
}

/** Every setting, parsed from the form; call only when validation passed. */
export function toSettings(values: ChatbotSettingsFormValues): ChatbotSettings {
  return {
    botName: values.botName.trim(),
    greetingMessage: values.greetingMessage.trim(),
    suggestedPrompts: nonEmptyPrompts(values.suggestedPrompts),
    systemInstruction: values.systemInstruction.trim(),
    fallbackMessage: values.fallbackMessage.trim(),
    answerOnlyFromDocuments: values.answerOnlyFromDocuments,
    answerTemperature: Number(values.answerTemperature),
    maxAnswerTokens: Number(values.maxAnswerTokens),
    maxSources: Number(values.maxSources),
    minSimilarity: Number(values.minSimilarity),
    showReasoning: values.showReasoning,
    showSources: values.showSources,
    reasoningEffort: values.reasoningEffort,
    memorySummaryThresholdRatio: Number(values.memorySummaryThresholdRatio),
    memoryRecentTurnCount: Number(values.memoryRecentTurnCount),
    maxMessageChars: Number(values.maxMessageChars),
    maxTurnsPerConversation: Number(values.maxTurnsPerConversation),
  };
}

export interface SettingChange {
  settingName: SettingName;
  label: string;
  before: string;
  after: string;
}

/** Every setting whose value differs between two versions, in form order, formatted for reading. */
export function listSettingChanges(current: ChatbotSettings, proposed: ChatbotSettings): SettingChange[] {
  return SETTING_ORDER.filter((settingName) => !isSameValue(current[settingName], proposed[settingName])).map(
    (settingName) => ({
      settingName,
      label: SETTING_LABELS[settingName],
      before: formatSettingValue(current[settingName]),
      after: formatSettingValue(proposed[settingName]),
    }),
  );
}

/** The editable part of a saved version, for comparing versions with each other. */
export function settingsOfVersion(version: ChatbotSettingsVersion): ChatbotSettings {
  return toSettings(formValuesFromSettings(version));
}

function textErrorMessage(value: string, maximumLength: number): string | undefined {
  const trimmedLength = value.trim().length;
  if (trimmedLength === 0) return 'Required.';
  if (trimmedLength > maximumLength) {
    return `At most ${formatInteger(maximumLength)} characters (now ${formatInteger(trimmedLength)}).`;
  }
  return undefined;
}

function numericErrorMessage(value: string, limits: NumericSettingLimits): string | undefined {
  const parsedValue = parseOptionalNumber(value);
  const rangeText = `${String(limits.minimum)} to ${String(limits.maximum)}`;
  if (parsedValue === null || parsedValue === undefined) return `Enter a number from ${rangeText}.`;
  if (limits.isInteger && !Number.isInteger(parsedValue)) return `Enter a whole number from ${rangeText}.`;
  if (parsedValue < limits.minimum || parsedValue > limits.maximum) return `Must be from ${rangeText}.`;
  return undefined;
}

function suggestedPromptsErrorMessage(prompts: readonly string[]): string | undefined {
  const filledPrompts = nonEmptyPrompts(prompts);
  if (filledPrompts.length > MAXIMUM_SUGGESTED_PROMPTS) return `At most ${MAXIMUM_SUGGESTED_PROMPTS} prompts.`;
  if (filledPrompts.some((prompt) => prompt.length > MAXIMUM_SUGGESTED_PROMPT_LENGTH)) {
    return `Each prompt can have at most ${MAXIMUM_SUGGESTED_PROMPT_LENGTH} characters.`;
  }
  return undefined;
}

function nonEmptyPrompts(prompts: readonly string[]): string[] {
  return prompts.map((prompt) => prompt.trim()).filter((prompt) => prompt !== '');
}

type SettingValue = ChatbotSettings[SettingName];

function isSameValue(first: SettingValue, second: SettingValue): boolean {
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((item, index) => item === second[index]);
  }
  return first === second;
}

function formatSettingValue(value: SettingValue): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) return value.length === 0 ? 'None' : value.map((item) => `“${item}”`).join(', ');
  return String(value);
}
