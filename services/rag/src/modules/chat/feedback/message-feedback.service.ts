import { Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application-error.js';
import type { FeedbackRating } from '../../../database/schema.js';
import type { VisitorPrincipal } from '../../public-access/visitor-principal.js';
import { ChatMessagesRepository } from '../persistence/chat-messages.repository.js';
import { MessageFeedbackRepository } from '../persistence/message-feedback.repository.js';

/** Thumbs up or down on an assistant reply. */
@Injectable()
export class MessageFeedbackService {
  constructor(
    private readonly chatMessagesRepository: ChatMessagesRepository,
    private readonly messageFeedbackRepository: MessageFeedbackRepository,
  ) {}

  async rate(
    visitor: VisitorPrincipal,
    messageId: string,
    rating: FeedbackRating,
    comment: string | undefined,
  ): Promise<void> {
    const found = await this.chatMessagesRepository.findWithOwner(messageId);
    if (found?.visitorSessionId !== visitor.visitorSessionId || found.message.role !== 'assistant') {
      throw new ApplicationError(404, 'not_found', 'No assistant message has this id.');
    }
    await this.messageFeedbackRepository.upsert(messageId, rating, comment ?? null);
  }
}
