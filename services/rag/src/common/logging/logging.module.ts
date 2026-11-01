import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { REQUEST_ID_HEADER, requestIdOf, resolveRequestId } from '../http/request-identity.js';
import { SERVICE_NAME, detectProcessRole } from '../process-role.js';

/** Header and body fields that must never appear in logs. */
const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

/** Health probes run every few seconds; logging them is noise. */
const QUIET_PATH_PREFIXES = ['/health/'];

function buildLoggerParams(configuration: ServiceConfiguration): Params {
  const { logLevel, logFormat } = configuration.observability;
  return {
    pinoHttp: {
      level: logLevel,
      base: { service: `${SERVICE_NAME}-${detectProcessRole(process.argv[1])}` },
      messageKey: 'message',
      redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' },
      genReqId: (incomingRequest: IncomingMessage, serverResponse: ServerResponse): string => {
        const requestId = resolveRequestId(incomingRequest);
        serverResponse.setHeader(REQUEST_ID_HEADER, requestId);
        return requestId;
      },
      customProps: (incomingRequest: IncomingMessage) => ({ requestId: requestIdOf(incomingRequest) }),
      autoLogging: {
        ignore: (incomingRequest: IncomingMessage) =>
          QUIET_PATH_PREFIXES.some((pathPrefix) => (incomingRequest.url ?? '').startsWith(pathPrefix)),
      },
      serializers: {
        // Log the path only: query strings may carry tokens or personal data.
        req: (request: { id: unknown; method: string; url: string }) => ({
          id: request.id,
          method: request.method,
          path: request.url.split('?')[0],
        }),
        res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
      },
      ...(logFormat === 'text'
        ? { transport: { target: 'pino-pretty', options: { singleLine: true, messageKey: 'message' } } }
        : {}),
    },
  };
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [SERVICE_CONFIGURATION],
      useFactory: buildLoggerParams,
    }),
  ],
})
export class LoggingModule {}
