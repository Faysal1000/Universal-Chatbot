import { Module } from '@nestjs/common';

import { AdminAccountBootstrapService } from './admin-account-bootstrap.service.js';
import { AdminAccountsRepository } from './admin-accounts.repository.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthenticationGuard } from './admin-authentication.guard.js';
import { AdminLoginService } from './admin-login.service.js';
import { AdminSessionsService } from './admin-sessions.service.js';

@Module({
  controllers: [AdminAuthController],
  providers: [
    AdminAccountsRepository,
    AdminSessionsService,
    AdminLoginService,
    AdminAccountBootstrapService,
    AdminAuthenticationGuard,
  ],
  exports: [AdminAuthenticationGuard, AdminSessionsService],
})
export class AdminAuthModule {}
