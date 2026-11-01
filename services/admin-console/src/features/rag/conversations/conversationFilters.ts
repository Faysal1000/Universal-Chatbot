import { isUuid } from '@/shared/lib/uuid';

import type { ConversationFilters } from './api/conversationTypes';

export const MAXIMUM_SEARCH_TEXT_LENGTH = 200;

/** URL search parameter names, so filtered lists can be linked to (e.g. "this visitor's conversations"). */
const CONVERSATION_SEARCH_PARAMETERS = { searchText: 'q', visitorSessionId: 'visitor' } as const;

export function readConversationFilters(searchParameters: URLSearchParams): ConversationFilters {
  return {
    searchText: searchParameters.get(CONVERSATION_SEARCH_PARAMETERS.searchText) ?? '',
    visitorSessionId: searchParameters.get(CONVERSATION_SEARCH_PARAMETERS.visitorSessionId) ?? '',
  };
}

export function toConversationSearchParameters(filters: ConversationFilters): URLSearchParams {
  const searchParameters = new URLSearchParams();
  if (filters.searchText.trim()) {
    searchParameters.set(CONVERSATION_SEARCH_PARAMETERS.searchText, filters.searchText.trim());
  }
  if (filters.visitorSessionId.trim()) {
    searchParameters.set(CONVERSATION_SEARCH_PARAMETERS.visitorSessionId, filters.visitorSessionId.trim());
  }
  return searchParameters;
}

export function hasActiveConversationFilters(filters: ConversationFilters): boolean {
  return filters.searchText.trim() !== '' || filters.visitorSessionId.trim() !== '';
}

/** Client-side checks mirroring the API limits; returns field messages keyed by filter name. */
export function validateConversationFilters(
  filters: ConversationFilters,
): Partial<Record<keyof ConversationFilters, string>> {
  const fieldErrors: Partial<Record<keyof ConversationFilters, string>> = {};
  if (filters.searchText.trim().length > MAXIMUM_SEARCH_TEXT_LENGTH) {
    fieldErrors.searchText = `Use at most ${MAXIMUM_SEARCH_TEXT_LENGTH} characters.`;
  }
  if (filters.visitorSessionId.trim() !== '' && !isUuid(filters.visitorSessionId)) {
    fieldErrors.visitorSessionId = 'Paste a full visitor session id (a UUID).';
  }
  return fieldErrors;
}

/** The link to every conversation of one visitor session. */
export function visitorConversationsSearch(visitorSessionId: string): string {
  return `?${toConversationSearchParameters({ searchText: '', visitorSessionId }).toString()}`;
}
