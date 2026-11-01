import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  activateChatbotSettingsVersion,
  getActiveChatbotSettings,
  listChatbotSettingsVersions,
  saveChatbotSettings,
} from './chatbotSettingsApi';
import { chatbotSettingsQueryKeys } from './chatbotSettingsQueryKeys';
import type { ChatbotSettingsSaveRequest } from './chatbotSettingsTypes';

export function useActiveChatbotSettings() {
  return useQuery({ queryKey: chatbotSettingsQueryKeys.active(), queryFn: getActiveChatbotSettings });
}

export function useChatbotSettingsVersions() {
  return useQuery({ queryKey: chatbotSettingsQueryKeys.versions(), queryFn: listChatbotSettingsVersions });
}

function useInvalidateChatbotSettings() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: chatbotSettingsQueryKeys.all });
}

export function useSaveChatbotSettings() {
  const invalidateChatbotSettings = useInvalidateChatbotSettings();
  return useMutation({
    mutationFn: (request: ChatbotSettingsSaveRequest) => saveChatbotSettings(request),
    onSuccess: invalidateChatbotSettings,
  });
}

export function useActivateChatbotSettingsVersion() {
  const invalidateChatbotSettings = useInvalidateChatbotSettings();
  return useMutation({
    mutationFn: (version: number) => activateChatbotSettingsVersion(version),
    onSuccess: invalidateChatbotSettings,
  });
}
