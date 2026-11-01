import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../../admin-auth/admin-auth.module.js';
import { AssetsModule } from '../../assets/assets.module.js';
import { ChatAttachmentsService } from '../attachments/chat-attachments.service.js';
import { ChatMessagePresenter } from '../conversations/chat-message-presenter.js';
import { ChatPersistenceModule } from '../persistence/chat-persistence.module.js';
import { PublicChatModule } from '../public-chat.module.js';
import { AdminConversationsController } from './admin-conversations.controller.js';
import { AdminConversationsService } from './admin-conversations.service.js';

@Module({
  imports: [AdminAuthModule, ChatPersistenceModule, AssetsModule, PublicChatModule],
  controllers: [AdminConversationsController],
  providers: [AdminConversationsService, ChatMessagePresenter, ChatAttachmentsService],
})
export class AdminConversationsModule {}
