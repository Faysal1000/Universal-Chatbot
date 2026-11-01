import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { PublicAccessModule } from '../public-access/public-access.module.js';
import { AnalyticsAdminController } from './analytics-admin.controller.js';
import { AnalyticsRepository } from './analytics.repository.js';

@Module({
  imports: [AdminAuthModule, PublicAccessModule],
  controllers: [AnalyticsAdminController],
  providers: [AnalyticsRepository],
})
export class AnalyticsAdminModule {}
