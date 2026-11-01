import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import { ApiJsonResponse, ApiQueryParameters } from '../../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe.js';
import { AdminAuthenticationGuard } from '../../admin-auth/admin-authentication.guard.js';
import { uuidParameterSchema } from '../conversations/public-chat.schemas.js';
import {
  adminConversationDetailSchema,
  type AdminConversationDetailView,
  adminConversationListQuerySchema,
  adminConversationPageSchema,
  type AdminConversationView,
  adminFeedbackSchema,
  type AdminFeedbackView,
  feedbackListQuerySchema,
} from './admin-conversations.schemas.js';
import { AdminConversationsService } from './admin-conversations.service.js';

@ApiTags('Admin: conversations')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin')
@UseGuards(AdminAuthenticationGuard)
export class AdminConversationsController {
  constructor(private readonly adminConversations: AdminConversationsService) {}

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

  @Get('feedback')
  @ApiOperation({ summary: 'Most recent visitor ratings of answers' })
  @ApiQueryParameters(feedbackListQuerySchema)
  @ApiJsonResponse(adminFeedbackSchema.array())
  listFeedback(
    @Query(new ZodValidationPipe(feedbackListQuerySchema)) query: z.infer<typeof feedbackListQuerySchema>,
  ): Promise<AdminFeedbackView[]> {
    return this.adminConversations.listFeedback(query.limit);
  }
}
