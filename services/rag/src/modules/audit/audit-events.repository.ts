import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { auditEvents } from '../../database/schema.js';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { AuditActor } from '../admin-auth/admin-principal.js';

export interface AuditEntry {
  readonly actor: AuditActor;
  /** Dotted verb, e.g. `document.uploaded`. */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
}

export type AuditEventRecord = typeof auditEvents.$inferSelect;

export interface AuditEventFilter {
  readonly action?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  /** Keyset cursor: only events older than this id. */
  readonly beforeId?: bigint;
  readonly limit: number;
}

/** Append-only record of every administrative change, shown in the admin console. */
@Injectable()
export class AuditEventsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.database.insert(auditEvents).values({
      actorAdminUserId: entry.actor.adminUserId,
      actorUsername: entry.actor.username,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: entry.details ?? {},
      requestId: entry.requestId ?? null,
    });
  }

  /** Newest first. */
  async list(filter: AuditEventFilter): Promise<AuditEventRecord[]> {
    const conditions: SQL[] = [];
    if (filter.action !== undefined) conditions.push(eq(auditEvents.action, filter.action));
    if (filter.targetType !== undefined) conditions.push(eq(auditEvents.targetType, filter.targetType));
    if (filter.targetId !== undefined) conditions.push(eq(auditEvents.targetId, filter.targetId));
    if (filter.beforeId !== undefined) conditions.push(lt(auditEvents.id, filter.beforeId));
    return this.database
      .select()
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.id))
      .limit(filter.limit);
  }
}
