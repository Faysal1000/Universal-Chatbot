import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { ClientBlocksAdminController } from './client-blocks-admin.controller.js';
import { PublicAccessModule } from './public-access.module.js';

@Module({ imports: [AdminAuthModule, PublicAccessModule], controllers: [ClientBlocksAdminController] })
export class PublicAccessAdminModule {}
