import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { createPublicCorsMiddleware } from '../common/http/public-cors.middleware.js';
import type { ProcessRole } from '../common/process-role.js';
import { SERVICE_VERSION } from '../common/service-version.js';
import type { ServiceConfiguration } from '../config/configuration.js';
import { WidgetAccessPolicy } from '../modules/widget-keys/widget-access.policy.js';

/**
 * HTTP hardening and documentation shared by the real entry points and the e2e tests,
 * so tests exercise exactly the production setup.
 */
export function configureHttpApplication(
  application: NestExpressApplication,
  configuration: ServiceConfiguration,
  processRole: ProcessRole,
): void {
  application.disable('x-powered-by');
  application.use(
    helmet({
      // Swagger UI needs inline styles; the JSON API itself never serves HTML.
      contentSecurityPolicy: configuration.server.enableApiDocs ? false : undefined,
      // The chat widget on the organisation's site loads attachment and page images from here.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  if (processRole === 'api') {
    const widgetAccessPolicy = application.get(WidgetAccessPolicy, { strict: false });
    application.use(
      '/v1/public',
      createPublicCorsMiddleware((origin) => widgetAccessPolicy.isCorsOriginAllowed(origin)),
    );
  }

  if (processRole === 'api' && configuration.server.enableApiDocs) {
    const openApiDocument = new DocumentBuilder()
      .setTitle('RAG API')
      .setDescription(
        'Core RAG backend: document ingestion, hybrid retrieval, grounded chat and administration. ' +
          'Errors are RFC 9457 application/problem+json bodies carrying a requestId.',
      )
      .setVersion(SERVICE_VERSION)
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', description: 'Visitor session token' },
        'visitor-session',
      )
      .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'RAG_ADMIN_API_KEY' }, 'admin-api-key')
      .addCookieAuth('rag_admin_session', { type: 'apiKey', in: 'cookie' }, 'admin-session')
      .build();
    SwaggerModule.setup(
      'docs',
      application,
      () => SwaggerModule.createDocument(application, openApiDocument),
      {
        jsonDocumentUrl: 'openapi.json',
      },
    );
  }
}
