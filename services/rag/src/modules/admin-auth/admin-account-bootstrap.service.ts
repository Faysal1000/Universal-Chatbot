import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { AdminAccountsRepository } from './admin-accounts.repository.js';

/**
 * Makes the account named in RAG_ADMIN_BOOTSTRAP_USERNAME exist with the configured
 * password hash on every API start. The environment is the source of truth for this
 * account, so rotating the hash and restarting resets its password.
 */
@Injectable()
export class AdminAccountBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAccountBootstrapService.name);

  constructor(
    private readonly adminAccountsRepository: AdminAccountsRepository,
    @Inject(SERVICE_CONFIGURATION) private readonly configuration: ServiceConfiguration,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const bootstrapAccount = this.configuration.admin.bootstrapAccount;
    if (bootstrapAccount === undefined) {
      this.logger.warn(
        'No bootstrap admin configured (RAG_ADMIN_BOOTSTRAP_USERNAME); admin sign-in is unavailable',
      );
      return;
    }
    const { wasCreated } = await this.adminAccountsRepository.upsertAccount(
      bootstrapAccount.username,
      bootstrapAccount.passwordHash.reveal(),
    );
    this.logger.log(
      `Bootstrap admin "${bootstrapAccount.username}" ${wasCreated ? 'created' : 'synchronised'}`,
    );
  }
}
