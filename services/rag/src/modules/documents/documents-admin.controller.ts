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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { requestIdOf } from '../../common/http/request-identity.js';
import { ServerSentEventStream } from '../../common/http/server-sent-events.js';
import { sendStoredFile } from '../../common/http/stored-file-response.js';
import {
  ApiJsonBody,
  ApiJsonResponse,
  ApiQueryParameters,
  toOpenApiSchema,
} from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAuthenticationGuard } from '../admin-auth/admin-authentication.guard.js';
import { type AdminPrincipal, CurrentAdmin } from '../admin-auth/admin-principal.js';
import type { IngestionRunReference } from '../ingestion/ingestion-jobs.js';
import { DocumentContentService } from './document-content.service.js';
import { documentPresenter } from './document-presenter.js';
import { DocumentProgressStreamService } from './document-progress-stream.service.js';
import { DocumentUploadService } from './document-upload.service.js';
import {
  acceptedDeletionSchema,
  acceptedIngestionSchema,
  type BlockView,
  chunkListQuerySchema,
  chunkListSchema,
  type ChunkView,
  type DocumentDetailView,
  documentDetailSchema,
  documentIdParameterSchema,
  documentListQuerySchema,
  documentListSchema,
  documentPageDetailSchema,
  documentPageSchema,
  type DocumentPageView,
  documentProgressEventSchema,
  documentSchema,
  documentUpdateSchema,
  type DocumentView,
  pageNumberParameterSchema,
} from './documents-admin.schemas.js';
import { DocumentsAdminService } from './documents-admin.service.js';

const IMAGE_CACHE_SECONDS = 300;
const uploadFormSchema = {
  type: 'object' as const,
  required: ['file'],
  properties: {
    file: { type: 'string' as const, format: 'binary', description: 'PDF, PNG, JPEG or TIFF' },
    title: { type: 'string' as const, maxLength: 300 },
  },
};

@ApiTags('Admin: documents')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/documents')
@UseGuards(AdminAuthenticationGuard)
export class DocumentsAdminController {
  constructor(
    private readonly documentUpload: DocumentUploadService,
    private readonly documentsAdmin: DocumentsAdminService,
    private readonly documentContent: DocumentContentService,
    private readonly progressStream: DocumentProgressStreamService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Upload a document',
    description:
      'Streams the file to storage and starts ingestion. 409 `duplicate_document` (with `details.existingDocumentId`) ' +
      'when identical bytes were uploaded before; 415 for types other than PDF, PNG, JPEG and TIFF.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: uploadFormSchema })
  @ApiCreatedResponse({ schema: toOpenApiSchema(documentSchema, 'output') })
  async upload(@Req() request: Request, @CurrentAdmin() principal: AdminPrincipal): Promise<DocumentView> {
    const document = await this.documentUpload.upload({
      request,
      principal,
      requestId: requestIdOf(request),
    });
    return documentPresenter.document(document);
  }

  @Get()
  @ApiOperation({ summary: 'List documents, newest first' })
  @ApiQueryParameters(documentListQuerySchema)
  @ApiJsonResponse(documentListSchema)
  list(
    @Query(new ZodValidationPipe(documentListQuerySchema)) query: z.infer<typeof documentListQuerySchema>,
  ): Promise<{ items: DocumentView[]; nextCursor: string | null }> {
    return this.documentsAdmin.list(query);
  }

  @Get(':documentId')
  @ApiOperation({ summary: 'A document with its ingestion runs and storage details' })
  @ApiJsonResponse(documentDetailSchema)
  describe(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
  ): Promise<DocumentDetailView> {
    return this.documentsAdmin.describe(documentId);
  }

  @Patch(':documentId')
  @ApiOperation({
    summary: 'Enable, disable or rename a document',
    description: 'A disabled document stays indexed but is never used to answer questions.',
  })
  @ApiJsonBody(documentUpdateSchema)
  @ApiJsonResponse(documentSchema)
  update(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @Body(new ZodValidationPipe(documentUpdateSchema)) changes: z.infer<typeof documentUpdateSchema>,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<DocumentView> {
    return this.documentsAdmin.update(documentId, changes, { principal, requestId: requestIdOf(request) });
  }

  @Delete(':documentId')
  @HttpCode(202)
  @ApiOperation({ summary: 'Delete a document from the index, storage and database (asynchronous)' })
  @ApiAcceptedResponse({ schema: toOpenApiSchema(acceptedDeletionSchema, 'output') })
  async delete(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<{ documentId: string; status: 'deleting' }> {
    await this.documentsAdmin.delete(documentId, { principal, requestId: requestIdOf(request) });
    return { documentId, status: 'deleting' };
  }

  @Post(':documentId/reprocess')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Parse, chunk and index the document again',
    description: 'Cancels an unfinished run. The current chunks keep answering until the new run finishes.',
  })
  @ApiAcceptedResponse({ schema: toOpenApiSchema(acceptedIngestionSchema, 'output') })
  reprocess(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IngestionRunReference> {
    return this.documentsAdmin.reprocess(documentId, { principal, requestId: requestIdOf(request) });
  }

  @Get(':documentId/events')
  @ApiOperation({
    summary: 'Ingestion progress as server-sent events',
    description:
      'Emits `progress` whenever the status or the latest run changes, and `deleted` if the document disappears. ' +
      'The stream ends once the document is `ready` or `failed`.',
  })
  @ApiProduces('text/event-stream')
  @ApiJsonResponse(documentProgressEventSchema, { description: 'Payload of each `progress` event' })
  async streamEvents(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.documentsAdmin.findOrFail(documentId);
    await this.progressStream.stream(documentId, new ServerSentEventStream(response));
  }

  @Get(':documentId/download')
  @ApiOperation({ summary: 'Download the original file' })
  @ApiProduces('application/octet-stream')
  async download(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const originalFile = await this.documentContent.openOriginal(documentId);
    await sendStoredFile(response, originalFile, {
      downloadFileName: originalFile.fileName,
      maxAgeSeconds: 0,
    });
  }

  @Get(':documentId/pages')
  @ApiOperation({ summary: 'Pages with their kind (digital, scanned, hybrid) and parse method' })
  @ApiJsonResponse(documentPageSchema.array())
  listPages(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
  ): Promise<DocumentPageView[]> {
    return this.documentContent.listPages(documentId);
  }

  @Get(':documentId/pages/:pageNumber')
  @ApiOperation({ summary: 'A page with its blocks, bounding boxes and extraction methods' })
  @ApiJsonResponse(documentPageDetailSchema)
  describePage(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @Param('pageNumber', new ZodValidationPipe(pageNumberParameterSchema)) pageNumber: number,
  ): Promise<DocumentPageView & { blocks: BlockView[] }> {
    return this.documentContent.describePage(documentId, pageNumber);
  }

  @Get(':documentId/pages/:pageNumber/image')
  @ApiOperation({ summary: 'The rendered page image (PNG), when the parser rendered one' })
  @ApiProduces('image/png')
  async sendPageImage(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @Param('pageNumber', new ZodValidationPipe(pageNumberParameterSchema)) pageNumber: number,
    @Res() response: Response,
  ): Promise<void> {
    const pageImage = await this.documentContent.openPageImage(documentId, pageNumber);
    await sendStoredFile(response, pageImage, { maxAgeSeconds: IMAGE_CACHE_SECONDS });
  }

  @Get(':documentId/blocks/:blockId/crop')
  @ApiOperation({ summary: 'The cropped image of a figure, chart or table block' })
  @ApiProduces('image/png')
  async sendBlockCrop(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @Param('blockId', new ZodValidationPipe(documentIdParameterSchema)) blockId: string,
    @Res() response: Response,
  ): Promise<void> {
    const cropImage = await this.documentContent.openBlockCrop(documentId, blockId);
    await sendStoredFile(response, cropImage, { maxAgeSeconds: IMAGE_CACHE_SECONDS });
  }

  @Get(':documentId/chunks')
  @ApiOperation({ summary: 'Chunks of the document in the live index version, in page order' })
  @ApiQueryParameters(chunkListQuerySchema)
  @ApiJsonResponse(chunkListSchema)
  listChunks(
    @Param('documentId', new ZodValidationPipe(documentIdParameterSchema)) documentId: string,
    @Query(new ZodValidationPipe(chunkListQuerySchema)) query: z.infer<typeof chunkListQuerySchema>,
  ): Promise<{ items: ChunkView[]; total: number; indexVersionId: number | null }> {
    return this.documentContent.listChunks(documentId, query.offset, query.limit);
  }
}
