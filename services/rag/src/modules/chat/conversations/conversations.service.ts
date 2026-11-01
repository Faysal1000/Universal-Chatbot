import { Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application-error.js';
import { decodeKeysetCursor, toPage } from '../../../common/pagination/keyset-cursor.js';
import { removeCitationMarkers } from '../../../domain/chat/citation-markers.js';
import { NEW_CONVERSATION_TITLE } from '../../../domain/chat/conversation-title.js';
import { ChatbotSettingsService } from '../../chatbot-settings/chatbot-settings.service.js';
import type { VisitorPrincipal } from '../../public-access/visitor-principal.js';
import { ChatMessagesRepository } from '../persistence/chat-messages.repository.js';
import { type ConversationRecord, ConversationsRepository } from '../persistence/conversations.repository.js';
import type { ConversationView } from '../turns/turn-stream-events.js';
import { ChatMessagePresenter } from './chat-message-presenter.js';
import { presentConversation } from './conversation-presenter.js';
import type { ChatMessageView } from './public-chat.schemas.js';

export interface Page<Item> {
  readonly items: Item[];
  readonly nextCursor: string | null;
}

/** A visitor's conversations and their history; nobody else's are ever visible. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly chatMessagesRepository: ChatMessagesRepository,
    private readonly chatMessagePresenter: ChatMessagePresenter,
    private readonly chatbotSettings: ChatbotSettingsService,
  ) {}

  async create(visitor: VisitorPrincipal, title: string | undefined): Promise<ConversationView> {
    const conversation = await this.conversationsRepository.insert(
      visitor.visitorSessionId,
      title ?? NEW_CONVERSATION_TITLE,
      title === undefined,
    );
    return presentConversation(conversation);
  }

  async list(
    visitor: VisitorPrincipal,
    query: { search?: string; cursor?: string; limit: number },
  ): Promise<Page<ConversationView>> {
    const rows = await this.conversationsRepository.list({
      visitorSessionId: visitor.visitorSessionId,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.cursor === undefined ? {} : { before: decodeKeysetCursor(query.cursor) }),
      limit: query.limit + 1,
    });
    return toPage(rows, query.limit, presentConversation, (conversation) => ({
      timestamp: conversation.updatedAt,
      id: conversation.id,
    }));
  }

  async rename(visitor: VisitorPrincipal, conversationId: string, title: string): Promise<ConversationView> {
    await this.findOwnedOrFail(visitor, conversationId);
    const renamed = await this.conversationsRepository.rename(conversationId, title);
    if (renamed === undefined) throw conversationNotFoundError();
    return presentConversation(renamed);
  }

  async delete(visitor: VisitorPrincipal, conversationId: string): Promise<void> {
    await this.findOwnedOrFail(visitor, conversationId);
    await this.conversationsRepository.delete(conversationId);
  }

  /** History in chronological order; `nextCursor` (a message id) pages to older messages. */
  async listMessages(
    visitor: VisitorPrincipal,
    conversationId: string,
    query: { before?: string; limit: number },
  ): Promise<Page<ChatMessageView>> {
    await this.findOwnedOrFail(visitor, conversationId);
    const beforeSequenceNumber = await this.sequenceNumberOf(conversationId, query.before);
    const rows = await this.chatMessagesRepository.listVisibleBefore(
      conversationId,
      beforeSequenceNumber,
      query.limit + 1,
    );
    const pageRows = rows.slice(0, query.limit).reverse();
    const oldestMessage = pageRows[0];
    const [messages, settings] = await Promise.all([
      this.chatMessagePresenter.present(pageRows),
      this.chatbotSettings.getActive(),
    ]);
    return {
      items: settings.showSources ? messages : messages.map(withoutSources),
      nextCursor: rows.length > query.limit && oldestMessage !== undefined ? oldestMessage.id : null,
    };
  }

  async findOwnedOrFail(visitor: VisitorPrincipal, conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.conversationsRepository.findOwned(
      conversationId,
      visitor.visitorSessionId,
    );
    if (conversation === undefined) throw conversationNotFoundError();
    return conversation;
  }

  private async sequenceNumberOf(
    conversationId: string,
    messageId: string | undefined,
  ): Promise<number | undefined> {
    if (messageId === undefined) return undefined;
    const message = await this.chatMessagesRepository.findById(messageId);
    if (message?.conversationId !== conversationId) {
      throw new ApplicationError(422, 'validation_failed', 'The request is invalid.', {
        fieldErrors: [{ field: 'before', message: 'Unknown message id.' }],
      });
    }
    return message.sequenceNumber;
  }
}

function conversationNotFoundError(): ApplicationError {
  return new ApplicationError(404, 'not_found', 'No conversation has this id.');
}

/** History as visitors see it while the admin hides sources; the stored citations stay. */
function withoutSources(message: ChatMessageView): ChatMessageView {
  return { ...message, content: removeCitationMarkers(message.content), citations: [] };
}
