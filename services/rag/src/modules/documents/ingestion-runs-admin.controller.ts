import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import type { IngestionRunStatus } from '../../database/schema.js';
import { ApiJsonResponse, ApiQueryParameters } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAuthenticationGuard } from '../admin-auth/admin-authentication.guard.js';
import { IngestionRunsRepository } from '../ingestion/ingestion-runs.repository.js';
import { documentPresenter } from './document-presenter.js';
import {
  ingestionRunListQuerySchema,
  ingestionRunWithDocumentSchema,
  type IngestionRunWithDocumentView,
} from './documents-admin.schemas.js';

const STATUSES_BY_FILTER: Record<
  z.infer<typeof ingestionRunListQuerySchema>['status'],
  IngestionRunStatus[]
> = {
  active: ['queued', 'running'],
  failed: ['failed'],
  finished: ['succeeded', 'failed', 'cancelled'],
  all: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
};

@ApiTags('Admin: documents')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/ingestion-runs')
@UseGuards(AdminAuthenticationGuard)
export class IngestionRunsAdminController {
  constructor(private readonly ingestionRunsRepository: IngestionRunsRepository) {}

  @Get()
  @ApiOperation({ summary: 'Ingestion runs across all documents, newest first' })
  @ApiQueryParameters(ingestionRunListQuerySchema)
  @ApiJsonResponse(ingestionRunWithDocumentSchema.array())
  async list(
    @Query(new ZodValidationPipe(ingestionRunListQuerySchema))
    query: z.infer<typeof ingestionRunListQuerySchema>,
  ): Promise<IngestionRunWithDocumentView[]> {
    const runs = await this.ingestionRunsRepository.listByStatuses(
      STATUSES_BY_FILTER[query.status],
      query.limit,
      query.documentId,
    );
    return runs.map((run) => ({ ...documentPresenter.ingestionRun(run), documentId: run.documentId }));
  }
}
