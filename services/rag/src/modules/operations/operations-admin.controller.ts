import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestIdOf } from '../../common/http/request-identity.js';
import { ApiJsonResponse, ApiQueryParameters } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  QueueAdministrationService,
  type QueueJobCounts,
  type StoredDeadLetter,
} from '../../queue/queue-administration.service.js';
import { AdminAuthenticationGuard } from '../admin-auth/admin-authentication.guard.js';
import { type AdminPrincipal, CurrentAdmin } from '../admin-auth/admin-principal.js';
import { type DeadLetterRetryOutcome, DeadLettersService } from './dead-letters.service.js';
import {
  deadLetterIdParameterSchema,
  deadLetterListQuerySchema,
  deadLetterPageSchema,
  deadLetterRetrySchema,
  type DeadLetterView,
  queueSummarySchema,
} from './operations-admin.schemas.js';

@ApiTags('Admin: operations')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin')
@UseGuards(AdminAuthenticationGuard)
export class OperationsAdminController {
  constructor(
    private readonly queueAdministration: QueueAdministrationService,
    private readonly deadLetters: DeadLettersService,
  ) {}

  @Get('queues')
  @ApiOperation({ summary: 'Job counts of every queue, including the parser queues' })
  @ApiJsonResponse(queueSummarySchema.array())
  listQueues(): Promise<QueueJobCounts[]> {
    return this.queueAdministration.countJobs();
  }

  @Get('dead-letters')
  @ApiOperation({ summary: 'Jobs that used up their retries, newest first' })
  @ApiQueryParameters(deadLetterListQuerySchema)
  @ApiJsonResponse(deadLetterPageSchema)
  async listDeadLetters(
    @Query(new ZodValidationPipe(deadLetterListQuerySchema)) query: z.infer<typeof deadLetterListQuerySchema>,
  ): Promise<{ items: DeadLetterView[]; total: number }> {
    const page = await this.deadLetters.list(query.offset, query.limit);
    return { items: page.items.map(presentDeadLetter), total: page.total };
  }

  @Post('dead-letters/:deadLetterId/retry')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Retry a dead letter',
    description:
      'An ingestion job starts a new run of its document; any other job goes back to its queue with ' +
      'fresh attempts. The dead letter is removed.',
  })
  @ApiJsonResponse(deadLetterRetrySchema, { status: 202 })
  retryDeadLetter(
    @Param('deadLetterId', new ZodValidationPipe(deadLetterIdParameterSchema)) deadLetterId: string,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<DeadLetterRetryOutcome> {
    return this.deadLetters.retry(deadLetterId, { principal, requestId: requestIdOf(request) });
  }

  @Delete('dead-letters/:deadLetterId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Discard a dead letter without retrying it' })
  @ApiNoContentResponse({ description: 'Discarded' })
  async discardDeadLetter(
    @Param('deadLetterId', new ZodValidationPipe(deadLetterIdParameterSchema)) deadLetterId: string,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<void> {
    await this.deadLetters.discard(deadLetterId, { principal, requestId: requestIdOf(request) });
  }
}

function presentDeadLetter({ id, record }: StoredDeadLetter): DeadLetterView {
  return {
    id,
    originalQueueName: record.originalQueueName,
    originalJobId: record.originalJobId ?? null,
    originalJobName: record.originalJobName,
    failureCode: record.failureCode,
    failureMessage: record.failureMessage,
    failedAt: record.failedAt,
    attemptsMade: record.attemptsMade,
    payload: record.payload,
  };
}
