/** Inline help under each chatbot setting: effect and range, nothing the label already says. */
import type { SettingName } from './chatbotSettingsFormModel';

export const SETTING_HELP_TEXTS: Record<SettingName, string> = {
  botName: 'Chat header and self-introduction.',
  greetingMessage: 'First message a visitor sees.',
  suggestedPrompts: 'Up to 6, shown under the greeting; empty rows are dropped.',
  systemInstruction: 'Tone, audience, what to refuse. Grounding in the documents is always enforced.',
  fallbackMessage: 'Sent when no document reaches Minimum similarity and answers stay in the documents.',
  answerOnlyFromDocuments:
    'Off: when no document matches, the model answers from the conversation or general knowledge.',
  answerTemperature: '0–2. Lower is more consistent.',
  maxAnswerTokens: '64–32,768. Up to 4× this when the context has room, for models that think first.',
  reasoningEffort: 'Higher is slower and more careful.',
  showReasoning: 'Needs reasoning effort above Off.',
  showSources: 'Citations and [n] markers. Stored for admins either way.',
  minSimilarity: 'Cosine 0–1 a passage must reach to be used. Default 0.60.',
  maxSources: '1–20 passages per answer, after deduplication.',
  memorySummaryThresholdRatio: '0.10–0.95 of the prompt budget before older turns are summarised.',
  memoryRecentTurnCount: '1–50 latest turns sent word for word.',
  maxMessageChars: '50–8,000 characters per visitor message.',
  maxTurnsPerConversation: '1–10,000. After that the visitor must start a new conversation.',
};
