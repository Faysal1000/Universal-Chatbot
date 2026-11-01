import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { ApplicationError } from '../../common/errors/application-error.js';
import { requestIdOf } from '../../common/http/request-identity.js';
import { ApiJsonBody, ApiJsonResponse } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAuthenticationGuard } from '../admin-auth/admin-authentication.guard.js';
import {
  type AdminPrincipal,
  actingAdminUserId,
  auditActorOf,
  CurrentAdmin,
} from '../admin-auth/admin-principal.js';
import { AuditEventsRepository } from '../audit/audit-events.repository.js';
import { type ClientBlockRecord, ClientBlocksRepository } from './client-blocks.repository.js';
import { ClientIdentityHasher } from './client-identity-hasher.js';
import { VisitorSessionsRepository } from './visitor-sessions.repository.js';
import { normaliseAddress } from '../../common/http/client-address.js';

const LISTED_BLOCKS = 500;

const createClientBlockSchema = z
  .object({
    visitorSessionId: z.uuid().optional().describe("Blocks the session's network address and device"),
    ipAddress: z.union([z.ipv4(), z.ipv6()]).optional(),
    reason: z.string().trim().min(1).max(500),
    expiresAt: z.iso.datetime().nullable().default(null).describe('Null blocks indefinitely'),
  })
  .refine((block) => (block.visitorSessionId === undefined) !== (block.ipAddress === undefined), {
    message: 'Send exactly one of visitorSessionId and ipAddress.',
  });

const clientBlockSchema = z.object({
  id: z.uuid(),
  ipHash: z.string().nullable(),
  fingerprintHash: z.string().nullable(),
  reason: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  createdByAdminUserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
type ClientBlockView = z.infer<typeof clientBlockSchema>;

@ApiTags('Admin: abuse protection')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/client-blocks')
@UseGuards(AdminAuthenticationGuard)
export class ClientBlocksAdminController {
  constructor(
    private readonly clientBlocksRepository: ClientBlocksRepository,
    private readonly visitorSessionsRepository: VisitorSessionsRepository,
    private readonly clientIdentityHasher: ClientIdentityHasher,
    private readonly auditEventsRepository: AuditEventsRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Blocked clients, newest first (addresses and devices only as keyed hashes)' })
  @ApiJsonResponse(clientBlockSchema.array())
  async list(): Promise<ClientBlockView[]> {
    return (await this.clientBlocksRepository.list(LISTED_BLOCKS)).map(presentClientBlock);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Block a visitor (by session) or a network address from the public chat' })
  @ApiJsonBody(createClientBlockSchema)
  @ApiJsonResponse(clientBlockSchema, { status: 201 })
  async create(
    @Body(new ZodValidationPipe(createClientBlockSchema)) body: z.infer<typeof createClientBlockSchema>,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<ClientBlockView> {
    const target = await this.resolveTarget(body);
    const block = await this.clientBlocksRepository.insert({
      ...target,
      reason: body.reason,
      expiresAt: body.expiresAt === null ? null : new Date(body.expiresAt),
      createdByAdminUserId: actingAdminUserId(principal),
    });
    await this.recordAudit(principal, request, 'client_block.created', block.id);
    return presentClientBlock(block);
  }

  @Delete(':blockId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Lift a block' })
  @ApiNoContentResponse()
  async delete(
    @Param('blockId', new ZodValidationPipe(z.uuid())) blockId: string,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<void> {
    if (!(await this.clientBlocksRepository.delete(blockId))) {
      throw new ApplicationError(404, 'not_found', 'No block has this id.');
    }
    await this.recordAudit(principal, request, 'client_block.deleted', blockId);
  }

  private async resolveTarget(
    body: z.infer<typeof createClientBlockSchema>,
  ): Promise<{ ipHash: string | null; fingerprintHash: string | null }> {
    if (body.ipAddress !== undefined) {
      return {
        ipHash: this.clientIdentityHasher.hashAddress(normaliseAddress(body.ipAddress)),
        fingerprintHash: null,
      };
    }
    const session = await this.visitorSessionsRepository.findById(body.visitorSessionId ?? '');
    if (session === undefined) {
      throw new ApplicationError(404, 'not_found', 'No visitor session has this id.');
    }
    return { ipHash: session.ipHash, fingerprintHash: session.fingerprintHash };
  }

  private async recordAudit(
    principal: AdminPrincipal,
    request: Request,
    action: string,
    blockId: string,
  ): Promise<void> {
    const requestId = requestIdOf(request);
    await this.auditEventsRepository.record({
      actor: auditActorOf(principal),
      action,
      targetType: 'client_block',
      targetId: blockId,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }
}

function presentClientBlock(block: ClientBlockRecord): ClientBlockView {
  return {
    id: block.id,
    ipHash: block.ipHash,
    fingerprintHash: block.fingerprintHash,
    reason: block.reason,
    expiresAt: block.expiresAt?.toISOString() ?? null,
    createdByAdminUserId: block.createdByAdminUserId,
    createdAt: block.createdAt.toISOString(),
  };
}
