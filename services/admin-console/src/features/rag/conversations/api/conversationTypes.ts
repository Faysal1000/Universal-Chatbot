import type { operations } from '@/contracts/rag';

export type ConversationPage =
  operations['AdminConversationsController_list']['responses'][200]['content']['application/json'];
export type ConversationSummary = ConversationPage['items'][number];
export type ConversationDetail =
  operations['AdminConversationsController_describe']['responses'][200]['content']['application/json'];
export type ConversationTurn = ConversationDetail['turns'][number];
export type ConversationMessage = ConversationTurn['messages'][number];
export type MessageCitation = ConversationMessage['citations'][number];

/** Filters `GET /conversations` supports; empty strings mean "not filtered". */
export interface ConversationFilters {
  /** Matches the title or any message text (case-insensitive, 1–200 characters). */
  searchText: string;
  visitorSessionId: string;
}

export const CONVERSATION_PAGE_SIZE = 25;
