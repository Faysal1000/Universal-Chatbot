import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../../admin-auth/admin-auth.module.js';
import { IndexVersionsModule } from '../index-versions.module.js';
import { IndexVersionsAdminController } from './index-versions-admin.controller.js';
import { IndexVersionsAdminService } from './index-versions-admin.service.js';

@Module({
  imports: [AdminAuthModule, IndexVersionsModule],
  controllers: [IndexVersionsAdminController],
  providers: [IndexVersionsAdminService],
})
export class IndexVersionsAdminModule {}
