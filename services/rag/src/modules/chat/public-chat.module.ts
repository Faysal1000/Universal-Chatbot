import { Module } from '@nestjs/common';

import { AssetsModule } from '../assets/assets.module.js';
import { ChatbotSettingsModule } from '../chatbot-settings/chatbot-settings.module.js';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { PublicAccessModule } from '../public-access/public-access.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { ChatAttachmentsService } from './attachments/chat-attachments.service.js';
import { CitationPreviewService } from './citations/citation-preview.service.js';
import { ChatMessagePresenter } from './conversations/chat-message-presenter.js';
import { ConversationsService } from './conversations/conversations.service.js';
import { MessageFeedbackService } from './feedback/message-feedback.service.js';
import { ChatPersistenceModule } from './persistence/chat-persistence.module.js';
import { PublicChatController } from './public-chat.controller.js';
import { PublicTurnsController } from './public-turns.controller.js';
import { AnswerPromptAssembler } from './turns/answer-prompt-assembler.js';
import { AnswerStreamer } from './turns/answer-streamer.js';
import { CitationAssembler } from './turns/citation-assembler.js';
import { ConversationHistoryService } from './turns/conversation-history.service.js';
import { QueryRewriteService } from './turns/query-rewrite.service.js';
import { RunningTurnsRegistry } from './turns/running-turns.registry.js';
import { SubmitTurnService } from './turns/submit-turn.service.js';
import { TurnCompletionService } from './turns/turn-completion.service.js';
import { TurnControl } from './turns/turn-control.js';
import { TurnEventLog } from './turns/turn-event-log.js';
import { TurnRunnerService } from './turns/turn-runner.service.js';
import { TurnStreamService } from './turns/turn-stream.service.js';

/** The public chat API: conversations, turns with streamed answers, attachments, citations, feedback. */
@Module({
  imports: [
    ChatPersistenceModule,
    PublicAccessModule,
    ChatbotSettingsModule,
    RetrievalModule,
    IngestionModule,
    AssetsModule,
  ],
  controllers: [PublicChatController, PublicTurnsController],
  providers: [
    ConversationsService,
    ChatMessagePresenter,
    ChatAttachmentsService,
    CitationPreviewService,
    MessageFeedbackService,
    SubmitTurnService,
    TurnStreamService,
    TurnRunnerService,
    TurnEventLog,
    TurnControl,
    RunningTurnsRegistry,
    ConversationHistoryService,
    QueryRewriteService,
    AnswerPromptAssembler,
    AnswerStreamer,
    CitationAssembler,
    TurnCompletionService,
  ],
  exports: [TurnStreamService],
})
export class PublicChatModule {}
