import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { WidgetKeysAdminController } from './widget-keys-admin.controller.js';
import { WidgetKeysModule } from './widget-keys.module.js';

@Module({ imports: [AdminAuthModule, WidgetKeysModule], controllers: [WidgetKeysAdminController] })
export class WidgetKeysAdminModule {}
