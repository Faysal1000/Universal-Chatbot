import type { ApiProtocolName } from './api/providerTypes';

export const API_PROTOCOL_LABELS: Record<ApiProtocolName, string> = {
  openai_chat_completions: 'OpenAI Chat Completions',
  openai_responses: 'OpenAI Responses',
  anthropic_messages: 'Anthropic Messages',
};

export const API_PROTOCOL_OPTIONS = (Object.keys(API_PROTOCOL_LABELS) as ApiProtocolName[]).map((protocolName) => ({
  value: protocolName,
  label: API_PROTOCOL_LABELS[protocolName],
}));

export function isApiProtocolName(value: string): value is ApiProtocolName {
  return value in API_PROTOCOL_LABELS;
}
