import { Module } from '@nestjs/common';

import { ChatAttachmentsRepository } from './chat-attachments.repository.js';
import { ChatMessagesRepository } from './chat-messages.repository.js';
import { ChatTurnsRepository } from './chat-turns.repository.js';
import { ConversationSummariesRepository } from './conversation-summaries.repository.js';
import { ConversationsRepository } from './conversations.repository.js';
import { MessageCitationsRepository } from './message-citations.repository.js';
import { MessageFeedbackRepository } from './message-feedback.repository.js';
import { RetrievalTracesRepository } from './retrieval-traces.repository.js';

const CHAT_REPOSITORIES = [
  ConversationsRepository,
  ChatTurnsRepository,
  ChatMessagesRepository,
  ChatAttachmentsRepository,
  MessageCitationsRepository,
  MessageFeedbackRepository,
  RetrievalTracesRepository,
  ConversationSummariesRepository,
];

@Module({ providers: CHAT_REPOSITORIES, exports: CHAT_REPOSITORIES })
export class ChatPersistenceModule {}
