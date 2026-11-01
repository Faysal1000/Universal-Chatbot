import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AuditAdminController } from './audit-admin.controller.js';

@Module({ imports: [AdminAuthModule], controllers: [AuditAdminController] })
export class AuditAdminModule {}
