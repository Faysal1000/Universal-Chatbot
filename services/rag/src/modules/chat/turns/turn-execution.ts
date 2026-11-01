import type { ChatbotSettingsRecord } from '../../chatbot-settings/chatbot-settings.repository.js';
import type { ChatAttachmentRecord } from '../persistence/chat-attachments.repository.js';
import type { ConversationRecord } from '../persistence/conversations.repository.js';

/** One visitor message of the turn being answered. */
export interface TurnUserMessage {
  readonly id: string;
  readonly clientMessageId: string;
  readonly content: string;
  readonly attachments: readonly ChatAttachmentRecord[];
}

/** Everything the runner needs to answer a turn that has just been stored. */
export interface TurnExecution {
  readonly turnId: string;
  readonly conversation: ConversationRecord;
  readonly assistantMessageId: string;
  readonly userMessages: readonly TurnUserMessage[];
  readonly settings: ChatbotSettingsRecord;
  readonly requestId: string | undefined;
  readonly abortSignal: AbortSignal;
  readonly startedAtMilliseconds: number;
}

/** What the answer step produced, whether it ran to the end or was interrupted. */
export interface GeneratedAnswer {
  readonly content: string;
  readonly reasoning: string | null;
  readonly finishReason: 'stop' | 'length' | 'no_evidence' | 'cancelled';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly servedByModel: string | null;
  readonly timeToFirstTokenMilliseconds: number | null;
}
