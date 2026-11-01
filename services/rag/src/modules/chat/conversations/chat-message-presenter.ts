import { Injectable } from '@nestjs/common';

import { ChatAttachmentsService } from '../attachments/chat-attachments.service.js';
import { ChatAttachmentsRepository } from '../persistence/chat-attachments.repository.js';
import type { ChatMessageRecord } from '../persistence/chat-messages.repository.js';
import { MessageCitationsRepository } from '../persistence/message-citations.repository.js';
import { MessageFeedbackRepository } from '../persistence/message-feedback.repository.js';
import { presentCitation } from '../turns/citation-assembler.js';
import type { ChatMessageView } from './public-chat.schemas.js';

/** Messages with their attachments (signed URLs), citations and feedback, in three queries. */
@Injectable()
export class ChatMessagePresenter {
  constructor(
    private readonly chatAttachmentsRepository: ChatAttachmentsRepository,
    private readonly messageCitationsRepository: MessageCitationsRepository,
    private readonly messageFeedbackRepository: MessageFeedbackRepository,
    private readonly chatAttachments: ChatAttachmentsService,
  ) {}

  async present(messages: readonly ChatMessageRecord[]): Promise<ChatMessageView[]> {
    const messageIds = messages.map((message) => message.id);
    const [attachments, citations, feedback] = await Promise.all([
      this.chatAttachmentsRepository.listForMessages(messageIds),
      this.messageCitationsRepository.listForMessages(messageIds),
      this.messageFeedbackRepository.listForMessages(messageIds),
    ]);
    return messages.map((message) => ({
      id: message.id,
      turnId: message.turnId,
      role: message.role,
      content: message.content,
      attachments: attachments
        .filter((attachment) => attachment.messageId === message.id)
        .map((attachment) => this.chatAttachments.present(attachment)),
      citations: citations.filter((citation) => citation.messageId === message.id).map(presentCitation),
      reasoning: message.reasoning,
      // A reply still being written is shown as far as it got.
      status: message.status === 'streaming' ? 'complete' : message.status,
      createdAt: message.createdAt.toISOString(),
      feedback: feedback.find((rating) => rating.messageId === message.id)?.rating ?? null,
    }));
  }
}
