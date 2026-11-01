import { Module } from '@nestjs/common';

import { ChatPersistenceModule } from '../persistence/chat-persistence.module.js';
import { ConversationSummaryHandler } from './conversation-summary.handler.js';
import { ConversationSummaryService } from './conversation-summary.service.js';

@Module({
  imports: [ChatPersistenceModule],
  providers: [ConversationSummaryService, ConversationSummaryHandler],
  exports: [ConversationSummaryHandler],
})
export class ConversationSummariesWorkerModule {}
