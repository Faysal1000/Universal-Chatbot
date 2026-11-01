import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';

import {
  ApiJsonBody,
  ApiJsonResponse,
  ApiQueryParameters,
  toOpenApiSchema,
} from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { VisitorAuthenticationGuard } from '../public-access/visitor-authentication.guard.js';
import { CurrentVisitor, type VisitorPrincipal } from '../public-access/visitor-principal.js';
import { type AttachmentView, ChatAttachmentsService } from './attachments/chat-attachments.service.js';
import { CitationPreviewService } from './citations/citation-preview.service.js';
import { ConversationsService, type Page } from './conversations/conversations.service.js';
import {
  attachmentSchema,
  chatMessagePageSchema,
  type ChatMessageView,
  citationPreviewSchema,
  type CitationPreviewView,
  conversationListQuerySchema,
  conversationPageSchema,
  conversationSchema,
  createConversationRequestSchema,
  feedbackRequestSchema,
  messageListQuerySchema,
  renameConversationRequestSchema,
  uuidParameterSchema,
} from './conversations/public-chat.schemas.js';
import { MessageFeedbackService } from './feedback/message-feedback.service.js';
import type { ConversationView } from './turns/turn-stream-events.js';

const imageUploadFormSchema = {
  type: 'object' as const,
  required: ['file'],
  properties: { file: { type: 'string' as const, format: 'binary', description: 'JPEG, PNG or WEBP' } },
};

@ApiTags('Public: conversations')
@ApiBearerAuth('visitor-session')
@Controller('v1/public')
@UseGuards(VisitorAuthenticationGuard)
export class PublicChatController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly chatAttachments: ChatAttachmentsService,
    private readonly citationPreview: CitationPreviewService,
    private readonly messageFeedback: MessageFeedbackService,
  ) {}

  @Get('conversations')
  @ApiOperation({
    summary: "The visitor's conversations, most recently updated first; `q` searches titles and messages",
  })
  @ApiQueryParameters(conversationListQuerySchema)
  @ApiJsonResponse(conversationPageSchema)
  listConversations(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Query(new ZodValidationPipe(conversationListQuerySchema))
    query: z.infer<typeof conversationListQuerySchema>,
  ): Promise<Page<ConversationView>> {
    return this.conversations.list(visitor, {
      ...(query.q === undefined ? {} : { search: query.q }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit,
    });
  }

  @Post('conversations')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Start a conversation; without a title the server titles it from the first message',
  })
  @ApiJsonBody(createConversationRequestSchema)
  @ApiCreatedResponse({ schema: toOpenApiSchema(conversationSchema, 'output') })
  createConversation(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Body(new ZodValidationPipe(createConversationRequestSchema))
    body: z.infer<typeof createConversationRequestSchema>,
  ): Promise<ConversationView> {
    return this.conversations.create(visitor, body.title);
  }

  @Patch('conversations/:conversationId')
  @ApiOperation({ summary: 'Rename a conversation (stops automatic titling)' })
  @ApiJsonBody(renameConversationRequestSchema)
  @ApiJsonResponse(conversationSchema)
  renameConversation(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Param('conversationId', new ZodValidationPipe(uuidParameterSchema)) conversationId: string,
    @Body(new ZodValidationPipe(renameConversationRequestSchema))
    body: z.infer<typeof renameConversationRequestSchema>,
  ): Promise<ConversationView> {
    return this.conversations.rename(visitor, conversationId, body.title);
  }

  @Delete('conversations/:conversationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a conversation and its whole history' })
  @ApiNoContentResponse()
  async deleteConversation(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Param('conversationId', new ZodValidationPipe(uuidParameterSchema)) conversationId: string,
  ): Promise<void> {
    await this.conversations.delete(visitor, conversationId);
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({
    summary: 'One page of history, chronological; pass `nextCursor` as `before` for older messages',
  })
  @ApiQueryParameters(messageListQuerySchema)
  @ApiJsonResponse(chatMessagePageSchema)
  listMessages(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Param('conversationId', new ZodValidationPipe(uuidParameterSchema)) conversationId: string,
    @Query(new ZodValidationPipe(messageListQuerySchema)) query: z.infer<typeof messageListQuerySchema>,
  ): Promise<Page<ChatMessageView>> {
    return this.conversations.listMessages(visitor, conversationId, {
      ...(query.before === undefined ? {} : { before: query.before }),
      limit: query.limit,
    });
  }

  @Post('attachments')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Upload an image for a later turn',
    description:
      'JPEG, PNG or WEBP up to `/config.limits.maxImageBytes`. The image is re-encoded without metadata. ' +
      'Unused uploads expire after an hour. 413 `attachment_too_large`, 415 `unsupported_media_type`.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: imageUploadFormSchema })
  @ApiCreatedResponse({ schema: toOpenApiSchema(attachmentSchema, 'output') })
  uploadAttachment(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Req() request: Request,
  ): Promise<AttachmentView> {
    return this.chatAttachments.upload(request, visitor);
  }

  @Get('citations/:citationId/preview')
  @ApiOperation({ summary: 'Page image and crop of a cited source (signed URLs valid for 5 minutes)' })
  @ApiJsonResponse(citationPreviewSchema)
  describeCitation(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Param('citationId', new ZodValidationPipe(uuidParameterSchema)) citationId: string,
  ): Promise<CitationPreviewView> {
    return this.citationPreview.describe(visitor, citationId);
  }

  @Post('messages/:messageId/feedback')
  @HttpCode(204)
  @ApiOperation({ summary: 'Rate an assistant reply; rating again replaces the earlier rating' })
  @ApiJsonBody(feedbackRequestSchema)
  @ApiNoContentResponse()
  async rateMessage(
    @CurrentVisitor() visitor: VisitorPrincipal,
    @Param('messageId', new ZodValidationPipe(uuidParameterSchema)) messageId: string,
    @Body(new ZodValidationPipe(feedbackRequestSchema)) body: z.infer<typeof feedbackRequestSchema>,
  ): Promise<void> {
    await this.messageFeedback.rate(visitor, messageId, body.rating, body.comment);
  }
}
