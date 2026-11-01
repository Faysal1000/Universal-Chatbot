import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, lt } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { visitorSessions } from '../../database/schema.js';

export type VisitorSessionRecord = typeof visitorSessions.$inferSelect;
export type NewVisitorSessionRecord = typeof visitorSessions.$inferInsert;

@Injectable()
export class VisitorSessionsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insert(session: NewVisitorSessionRecord): Promise<VisitorSessionRecord> {
    const [inserted] = await this.database.insert(visitorSessions).values(session).returning();
    if (inserted === undefined) throw new Error('Inserting a visitor session returned no row');
    return inserted;
  }

  async findById(sessionId: string): Promise<VisitorSessionRecord | undefined> {
    const [session] = await this.database
      .select()
      .from(visitorSessions)
      .where(eq(visitorSessions.id, sessionId));
    return session;
  }

  async findUnexpiredByTokenHash(tokenHash: string, now: Date): Promise<VisitorSessionRecord | undefined> {
    const [session] = await this.database
      .select()
      .from(visitorSessions)
      .where(and(eq(visitorSessions.tokenHash, tokenHash), gt(visitorSessions.expiresAt, now)));
    return session;
  }

  /** Sliding expiry: every use pushes the expiry out again. */
  async extend(sessionId: string, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    await this.database
      .update(visitorSessions)
      .set({ lastSeenAt, expiresAt })
      .where(eq(visitorSessions.id, sessionId));
  }

  /** Deletes the sessions with their conversations (cascade); the caller removes their objects first. */
  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const deleted = await this.database
      .delete(visitorSessions)
      .where(lt(visitorSessions.expiresAt, cutoff))
      .returning({ id: visitorSessions.id });
    return deleted.length;
  }
}
