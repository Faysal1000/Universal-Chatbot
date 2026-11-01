import { Controller, Delete, Get, HttpCode, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';

import { ApiJsonResponse, ApiQueryParameters } from '../../../common/openapi/api-schema.decorators.js';
import { requestIdOf } from '../../../common/http/request-identity.js';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe.js';
import { AdminAuthenticationGuard } from '../../admin-auth/admin-authentication.guard.js';
import { type AdminPrincipal, auditActorOf, CurrentAdmin } from '../../admin-auth/admin-principal.js';
import { AuditEventsRepository } from '../../audit/audit-events.repository.js';
import { uuidParameterSchema } from '../conversations/public-chat.schemas.js';
import {
  adminConversationDetailSchema,
  type AdminConversationDetailView,
  adminConversationListQuerySchema,
  adminConversationPageSchema,
  type AdminConversationView,
  adminFeedbackSchema,
  type AdminFeedbackView,
  deleteConversationQuerySchema,
  feedbackListQuerySchema,
} from './admin-conversations.schemas.js';
import { AdminConversationsService } from './admin-conversations.service.js';

@ApiTags('Admin: conversations')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin')
@UseGuards(AdminAuthenticationGuard)
export class AdminConversationsController {
  constructor(
    private readonly adminConversations: AdminConversationsService,
    private readonly auditEventsRepository: AuditEventsRepository,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'All visitor conversations, most recently active first' })
  @ApiQueryParameters(adminConversationListQuerySchema)
  @ApiJsonResponse(adminConversationPageSchema)
  list(
    @Query(new ZodValidationPipe(adminConversationListQuerySchema))
    query: z.infer<typeof adminConversationListQuerySchema>,
  ): Promise<{ items: AdminConversationView[]; nextCursor: string | null }> {
    return this.adminConversations.list(query);
  }

  @Get('conversations/:conversationId')
  @ApiOperation({
    summary: 'A conversation with every turn, its rewritten queries, retrieval trace and rolling summary',
  })
  @ApiJsonResponse(adminConversationDetailSchema)
  describe(
    @Param('conversationId', new ZodValidationPipe(uuidParameterSchema)) conversationId: string,
  ): Promise<AdminConversationDetailView> {
    return this.adminConversations.describe(conversationId);
  }

  @Delete('conversations/:conversationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a conversation with its messages, feedback and summary' })
  @ApiQueryParameters(deleteConversationQuerySchema)
  @ApiNoContentResponse()
  async delete(
    @Param('conversationId', new ZodValidationPipe(uuidParameterSchema)) conversationId: string,
    @Query(new ZodValidationPipe(deleteConversationQuerySchema))
    query: z.infer<typeof deleteConversationQuerySchema>,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<void> {
    await this.adminConversations.delete(conversationId, query.force);
    await this.recordAudit(principal, request, 'conversation.deleted', 'conversation', conversationId);
  }

  @Get('feedback')
  @ApiOperation({ summary: 'Most recent visitor ratings of answers' })
  @ApiQueryParameters(feedbackListQuerySchema)
  @ApiJsonResponse(adminFeedbackSchema.array())
  listFeedback(
    @Query(new ZodValidationPipe(feedbackListQuerySchema)) query: z.infer<typeof feedbackListQuerySchema>,
  ): Promise<AdminFeedbackView[]> {
    return this.adminConversations.listFeedback(query.limit);
  }

  @Delete('feedback/:messageId')
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a visitor's rating of an answer" })
  @ApiNoContentResponse()
  async deleteFeedback(
    @Param('messageId', new ZodValidationPipe(uuidParameterSchema)) messageId: string,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<void> {
    await this.adminConversations.deleteFeedback(messageId);
    await this.recordAudit(principal, request, 'feedback.deleted', 'message', messageId);
  }

  private async recordAudit(
    principal: AdminPrincipal,
    request: Request,
    action: string,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    const requestId = requestIdOf(request);
    await this.auditEventsRepository.record({
      actor: auditActorOf(principal),
      action,
      targetType,
      targetId,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }
}
