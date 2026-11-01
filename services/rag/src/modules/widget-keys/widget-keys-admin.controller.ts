import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { WidgetAccessPolicy } from './widget-access.policy.js';
import { generatePublishableKey } from './widget-key-format.js';
import {
  type CreateWidgetKeyRequest,
  createWidgetKeySchema,
  type UpdateWidgetKeyRequest,
  updateWidgetKeySchema,
  widgetKeySchema,
  type WidgetKeyView,
} from './widget-keys-admin.schemas.js';
import { type WidgetKeyRecord, WidgetKeysRepository } from './widget-keys.repository.js';

@ApiTags('Admin: website widgets')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/widget-keys')
@UseGuards(AdminAuthenticationGuard)
export class WidgetKeysAdminController {
  constructor(
    private readonly widgetKeysRepository: WidgetKeysRepository,
    private readonly widgetAccessPolicy: WidgetAccessPolicy,
    private readonly auditEventsRepository: AuditEventsRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Publishable keys of the website widget, newest first (revoked ones included)' })
  @ApiJsonResponse(widgetKeySchema.array())
  async list(): Promise<WidgetKeyView[]> {
    return (await this.widgetKeysRepository.list()).map(presentWidgetKey);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a publishable key for a website',
    description:
      'The key goes into the page source, so it is not a secret: rag accepts it only from the listed origins, ' +
      'together with Turnstile and the public rate limits.',
  })
  @ApiJsonBody(createWidgetKeySchema)
  @ApiJsonResponse(widgetKeySchema, { status: 201 })
  async create(
    @Body(new ZodValidationPipe(createWidgetKeySchema)) body: CreateWidgetKeyRequest,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<WidgetKeyView> {
    const created = await this.widgetKeysRepository.insert({
      name: body.name,
      publishableKey: generatePublishableKey(),
      allowedOrigins: body.allowedOrigins,
      turnsPerMinute: body.turnsPerMinute,
      createdByAdminUserId: actingAdminUserId(principal),
    });
    await this.recordChange(principal, request, 'widget_key.created', created, { name: created.name });
    return presentWidgetKey(created);
  }

  @Patch(':widgetKeyId')
  @ApiOperation({ summary: 'Rename a key, change its websites or its answers-per-minute limit' })
  @ApiJsonBody(updateWidgetKeySchema)
  @ApiJsonResponse(widgetKeySchema)
  async update(
    @Param('widgetKeyId', new ZodValidationPipe(z.uuid())) widgetKeyId: string,
    @Body(new ZodValidationPipe(updateWidgetKeySchema)) body: UpdateWidgetKeyRequest,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<WidgetKeyView> {
    const existing = await this.findOrThrow(widgetKeyId);
    if (existing.revokedAt !== null) {
      throw new ApplicationError(
        409,
        'widget_key_revoked',
        'A revoked key cannot be changed. Create a new one.',
      );
    }
    const updated = await this.widgetKeysRepository.update(widgetKeyId, body);
    if (updated === undefined) throw notFound();
    await this.recordChange(principal, request, 'widget_key.updated', updated, {
      changedFields: Object.keys(body).join(','),
    });
    return presentWidgetKey(updated);
  }

  @Post(':widgetKeyId/revoke')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke a key',
    description: 'Its websites lose the chat at once (other api replicas within seconds). Idempotent.',
  })
  @ApiJsonResponse(widgetKeySchema)
  async revoke(
    @Param('widgetKeyId', new ZodValidationPipe(z.uuid())) widgetKeyId: string,
    @CurrentAdmin() principal: AdminPrincipal,
    @Req() request: Request,
  ): Promise<WidgetKeyView> {
    const existing = await this.findOrThrow(widgetKeyId);
    if (existing.revokedAt !== null) return presentWidgetKey(existing);
    const revoked = await this.widgetKeysRepository.revoke(widgetKeyId, new Date());
    if (revoked === undefined) throw notFound();
    await this.recordChange(principal, request, 'widget_key.revoked', revoked, { name: revoked.name });
    return presentWidgetKey(revoked);
  }

  private async findOrThrow(widgetKeyId: string): Promise<WidgetKeyRecord> {
    const widgetKey = await this.widgetKeysRepository.findById(widgetKeyId);
    if (widgetKey === undefined) throw notFound();
    return widgetKey;
  }

  private async recordChange(
    principal: AdminPrincipal,
    request: Request,
    action: string,
    widgetKey: WidgetKeyRecord,
    details: Record<string, string>,
  ): Promise<void> {
    this.widgetAccessPolicy.invalidate();
    const requestId = requestIdOf(request);
    await this.auditEventsRepository.record({
      actor: auditActorOf(principal),
      action,
      targetType: 'widget_key',
      targetId: widgetKey.id,
      details,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }
}

function notFound(): ApplicationError {
  return new ApplicationError(404, 'not_found', 'No widget key has this id.');
}

function presentWidgetKey(widgetKey: WidgetKeyRecord): WidgetKeyView {
  return {
    id: widgetKey.id,
    name: widgetKey.name,
    publishableKey: widgetKey.publishableKey,
    allowedOrigins: widgetKey.allowedOrigins,
    turnsPerMinute: widgetKey.turnsPerMinute,
    status: widgetKey.revokedAt === null ? 'active' : 'revoked',
    createdAt: widgetKey.createdAt.toISOString(),
    updatedAt: widgetKey.updatedAt.toISOString(),
    revokedAt: widgetKey.revokedAt?.toISOString() ?? null,
  };
}
