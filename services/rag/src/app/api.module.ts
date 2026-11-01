import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ProblemDetailsExceptionFilter } from '../common/errors/problem-details.filter.js';
import { JsonBodyParserMiddleware } from '../common/http/json-body-parser.middleware.js';
import type { ServiceConfiguration } from '../config/configuration.js';
import { AdminAuthModule } from '../modules/admin-auth/admin-auth.module.js';
import { AnalyticsAdminModule } from '../modules/analytics/analytics-admin.module.js';
import { AssetsModule } from '../modules/assets/assets.module.js';
import { AuditAdminModule } from '../modules/audit/audit-admin.module.js';
import { AdminConversationsModule } from '../modules/chat/admin/admin-conversations.module.js';
import { PublicChatModule } from '../modules/chat/public-chat.module.js';
import { ChatbotSettingsAdminModule } from '../modules/chatbot-settings/chatbot-settings-admin.module.js';
import { DocumentsAdminModule } from '../modules/documents/documents-admin.module.js';
import { IndexVersionsAdminModule } from '../modules/index-versions/admin/index-versions-admin.module.js';
import { OperationsAdminModule } from '../modules/operations/operations-admin.module.js';
import { PublicAccessModule } from '../modules/public-access/public-access.module.js';
import { PublicAccessAdminModule } from '../modules/public-access/public-access-admin.module.js';
import { WidgetKeysAdminModule } from '../modules/widget-keys/widget-keys-admin.module.js';
import { coreModules } from './core-modules.js';

/** Matches every path, including ones no controller handles. */
const ALL_ROUTES = '{*path}';

/**
 * Root module of the HTTP API process: the public chat API and the admin API.
 */
@Module({})
export class ApiModule implements NestModule {
  static register(configuration: ServiceConfiguration): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        ...coreModules(configuration),
        AdminAuthModule,
        DocumentsAdminModule,
        ChatbotSettingsAdminModule,
        AdminConversationsModule,
        PublicAccessAdminModule,
        OperationsAdminModule,
        IndexVersionsAdminModule,
        AnalyticsAdminModule,
        AuditAdminModule,
        WidgetKeysAdminModule,
        PublicAccessModule,
        PublicChatModule,
        AssetsModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter }],
    };
  }

  configure(middlewareConsumer: MiddlewareConsumer): void {
    middlewareConsumer.apply(JsonBodyParserMiddleware).forRoutes(ALL_ROUTES);
  }
}
