import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../../database/database.tokens.js';
import { adminSessions, adminUsers } from '../../database/schema.js';

export interface AdminAccount {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
}

export interface ActiveAdminSession {
  readonly adminUserId: string;
  readonly username: string;
  readonly expiresAt: Date;
}

export interface NewAdminSession {
  readonly tokenHash: string;
  readonly adminUserId: string;
  readonly ipHash: string;
  readonly userAgent: string | null;
  readonly expiresAt: Date;
}

@Injectable()
export class AdminAccountsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findByUsername(username: string): Promise<AdminAccount | undefined> {
    const [account] = await this.database
      .select({
        id: adminUsers.id,
        username: adminUsers.username,
        passwordHash: adminUsers.passwordHash,
        isActive: adminUsers.isActive,
      })
      .from(adminUsers)
      .where(eq(sql`lower(${adminUsers.username})`, username.toLowerCase()));
    return account;
  }

  /**
   * Creates the account, or resets its password and re-activates it when it exists. A changed
   * password signs out every existing session, as a rotation after a leak expects.
   */
  async upsertAccount(username: string, passwordHash: string): Promise<{ wasCreated: boolean }> {
    const existingAccount = await this.findByUsername(username);
    if (existingAccount === undefined) {
      await this.database.insert(adminUsers).values({ username, passwordHash });
      return { wasCreated: true };
    }
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(adminUsers)
        .set({ passwordHash, isActive: true })
        .where(eq(adminUsers.id, existingAccount.id));
      if (existingAccount.passwordHash !== passwordHash) {
        await transaction.delete(adminSessions).where(eq(adminSessions.adminUserId, existingAccount.id));
      }
    });
    return { wasCreated: false };
  }

  async recordLogin(adminUserId: string): Promise<void> {
    await this.database
      .update(adminUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(adminUsers.id, adminUserId));
  }

  async insertSession(session: NewAdminSession): Promise<void> {
    await this.database.insert(adminSessions).values(session);
  }

  async findActiveSession(tokenHash: string, now: Date): Promise<ActiveAdminSession | undefined> {
    const [session] = await this.database
      .select({
        adminUserId: adminUsers.id,
        username: adminUsers.username,
        expiresAt: adminSessions.expiresAt,
      })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
      .where(
        and(
          eq(adminSessions.tokenHash, tokenHash),
          gt(adminSessions.expiresAt, now),
          eq(adminUsers.isActive, true),
        ),
      );
    return session;
  }

  async touchSession(tokenHash: string): Promise<void> {
    await this.database
      .update(adminSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(adminSessions.tokenHash, tokenHash));
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.database.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
  }
}
