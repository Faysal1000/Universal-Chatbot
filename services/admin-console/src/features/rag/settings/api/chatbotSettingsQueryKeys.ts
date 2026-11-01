/** TanStack Query keys for chatbot settings; every key starts with `['rag', 'chatbot-settings']`. */
export const chatbotSettingsQueryKeys = {
  all: ['rag', 'chatbot-settings'] as const,
  active: () => [...chatbotSettingsQueryKeys.all, 'active'] as const,
  versions: () => [...chatbotSettingsQueryKeys.all, 'versions'] as const,
};
