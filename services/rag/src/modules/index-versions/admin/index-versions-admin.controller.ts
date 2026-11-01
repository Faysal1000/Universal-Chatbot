import { Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { requestIdOf } from '../../../common/http/request-identity.js';
import { ApiJsonResponse } from '../../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe.js';
import { INDEX_VERSION_STATUSES } from '../../../database/schema.js';
import { AdminAuthenticationGuard } from '../../admin-auth/admin-authentication.guard.js';
import { type AdminPrincipal, CurrentAdmin } from '../../admin-auth/admin-principal.js';
import { IndexVersionsAdminService, type IndexVersionSummary } from './index-versions-admin.service.js';

const indexVersionIdParameterSchema = z.coerce.number().int().positive();

const indexVersionSchema = z.object({
  id: z.number().int(),
  status: z.enum(INDEX_VERSION_STATUSES),
  embeddingModel: z.string(),
  embeddingModelRevision: z.string().nullable(),
  embeddingDimension: z.number().int(),
  chunkerVersion: z.string(),
  lexicalTokenizerVersion: z.string(),
  missingDocumentCount: z.number().int().describe('Ready documents not in this version; promote needs 0'),
  createdAt: z.iso.datetime(),
  promotedAt: z.iso.datetime().nullable(),
});
type IndexVersionView = z.infer<typeof indexVersionSchema>;

@ApiTags('Admin: index versions')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/index-versions')
@UseGuards(AdminAuthenticationGuard)
export class IndexVersionsAdminController {
  constructor(private readonly indexVersionsAdmin: IndexVersionsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Index versions, newest first' })
  @ApiJsonResponse(indexVersionSchema.array())
  async list(): Promise<IndexVersionView[]> {
    return (await this.indexVersionsAdmin.list()).map(presentIndexVersion);
  }

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Build a new index version',
    description:
      'Uses the current chunker and the model the embedding server serves now. Documents are re-chunked ' +
      'from stored blocks (no re-parsing) and embedded into the new version; answers keep using the live ' +
      'version until this one is promoted.',
  })
  @ApiJsonResponse(indexVersionSchema, { status: 202 })
  async create(
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IndexVersionView> {
    return presentIndexVersion(
      await this.indexVersionsAdmin.create({ principal, requestId: requestIdOf(request) }),
    );
  }

  @Post(':indexVersionId/build')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Resume a build or catch a version up',
    description: 'Indexes every ready document missing from the version, e.g. before rolling back to it.',
  })
  @ApiJsonResponse(indexVersionSchema, { status: 202 })
  async build(
    @Param('indexVersionId', new ZodValidationPipe(indexVersionIdParameterSchema)) indexVersionId: number,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IndexVersionView> {
    return presentIndexVersion(
      await this.indexVersionsAdmin.build(indexVersionId, { principal, requestId: requestIdOf(request) }),
    );
  }

  @Post(':indexVersionId/promote')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Make a version live (also how to roll back)',
    description:
      'Switches the live version atomically; the previous one is retired and kept. Refused with 409 ' +
      'while documents are missing from the version or when it holds another embedding model.',
  })
  @ApiJsonResponse(indexVersionSchema)
  async promote(
    @Param('indexVersionId', new ZodValidationPipe(indexVersionIdParameterSchema)) indexVersionId: number,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IndexVersionView> {
    return presentIndexVersion(
      await this.indexVersionsAdmin.promote(indexVersionId, { principal, requestId: requestIdOf(request) }),
    );
  }

  @Delete(':indexVersionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a retired, ready or failed version with its chunks and vectors' })
  @ApiNoContentResponse({ description: 'Deleted' })
  async delete(
    @Param('indexVersionId', new ZodValidationPipe(indexVersionIdParameterSchema)) indexVersionId: number,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<void> {
    await this.indexVersionsAdmin.delete(indexVersionId, { principal, requestId: requestIdOf(request) });
  }
}

function presentIndexVersion({ indexVersion, missingDocumentCount }: IndexVersionSummary): IndexVersionView {
  return {
    id: indexVersion.id,
    status: indexVersion.status,
    embeddingModel: indexVersion.embeddingModel,
    embeddingModelRevision: indexVersion.embeddingModelRevision,
    embeddingDimension: indexVersion.embeddingDimension,
    chunkerVersion: indexVersion.chunkerVersion,
    lexicalTokenizerVersion: indexVersion.lexicalTokenizerVersion,
    missingDocumentCount,
    createdAt: indexVersion.createdAt.toISOString(),
    promotedAt: indexVersion.promotedAt?.toISOString() ?? null,
  };
}
