import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ApiJsonResponse, ApiQueryParameters } from '../../common/openapi/api-schema.decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAuthenticationGuard } from '../admin-auth/admin-authentication.guard.js';
import { type AuditEventRecord, AuditEventsRepository } from './audit-events.repository.js';

const BIGINT_MAX = 9_223_372_036_854_775_807n;

const auditEventListQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional().describe('e.g. document.deleted'),
  targetType: z.string().trim().min(1).max(50).optional(),
  targetId: z.string().trim().min(1).max(200).optional(),
  cursor: z
    .string()
    .regex(/^\d{1,19}$/)
    .refine((cursor) => BigInt(cursor) <= BIGINT_MAX, 'The cursor is out of range.')
    .optional()
    .describe('nextCursor of the previous page'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const auditEventSchema = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  actorAdminUserId: z.uuid().nullable().describe('Null for the API key or a deleted admin'),
  actorUsername: z
    .string()
    .nullable()
    .describe(
      'Who acted: the signed-in admin, or the console user named in `X-Admin-Actor`; null if unknown',
    ),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  requestId: z.string().nullable(),
});
type AuditEventView = z.infer<typeof auditEventSchema>;

const auditEventPageSchema = z.object({
  items: z.array(auditEventSchema),
  nextCursor: z.string().nullable(),
});

@ApiTags('Admin: audit')
@ApiBearerAuth('admin-api-key')
@ApiCookieAuth('admin-session')
@Controller('v1/admin/audit-events')
@UseGuards(AdminAuthenticationGuard)
export class AuditAdminController {
  constructor(private readonly auditEventsRepository: AuditEventsRepository) {}

  @Get()
  @ApiOperation({ summary: 'Administrative changes, newest first' })
  @ApiQueryParameters(auditEventListQuerySchema)
  @ApiJsonResponse(auditEventPageSchema)
  async list(
    @Query(new ZodValidationPipe(auditEventListQuerySchema)) query: z.infer<typeof auditEventListQuerySchema>,
  ): Promise<{ items: AuditEventView[]; nextCursor: string | null }> {
    const events = await this.auditEventsRepository.list({
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.targetType === undefined ? {} : { targetType: query.targetType }),
      ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
      ...(query.cursor === undefined ? {} : { beforeId: BigInt(query.cursor) }),
      limit: query.limit + 1,
    });
    const pageEvents = events.slice(0, query.limit);
    const lastEvent = pageEvents.at(-1);
    return {
      items: pageEvents.map(presentAuditEvent),
      nextCursor: events.length > query.limit && lastEvent !== undefined ? String(lastEvent.id) : null,
    };
  }
}

function presentAuditEvent(event: AuditEventRecord): AuditEventView {
  return {
    id: String(event.id),
    occurredAt: event.occurredAt.toISOString(),
    actorAdminUserId: event.actorAdminUserId,
    actorUsername: event.actorUsername,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    details: event.details,
    requestId: event.requestId,
  };
}
