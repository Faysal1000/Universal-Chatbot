import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';

import type { ServiceConfiguration } from '../../config/configuration.js';
import { SERVICE_CONFIGURATION } from '../../config/configuration.module.js';
import { ApplicationError } from '../errors/application-error.js';

/** body-parser failure types mapped to stable, documented error codes. */
const BODY_PARSER_ERRORS: Readonly<Record<string, { status: number; code: string; message: string }>> = {
  'entity.parse.failed': {
    status: 400,
    code: 'invalid_json',
    message: 'The request body is not valid JSON.',
  },
  'entity.too.large': {
    status: 413,
    code: 'payload_too_large',
    message: 'The request body exceeds the maximum allowed size.',
  },
  'encoding.unsupported': {
    status: 415,
    code: 'unsupported_encoding',
    message: 'The request body encoding is not supported.',
  },
  'charset.unsupported': {
    status: 415,
    code: 'unsupported_charset',
    message: 'The request body charset is not supported; use UTF-8.',
  },
  'request.aborted': {
    status: 400,
    code: 'request_aborted',
    message: 'The request body was not fully received.',
  },
};

/**
 * JSON body parsing as Nest middleware (Nest's built-in parser is disabled) so parse
 * and size errors become problem+json responses with stable error codes.
 */
@Injectable()
export class JsonBodyParserMiddleware implements NestMiddleware {
  private readonly parseJsonBody: express.RequestHandler;
  private readonly bodyLimitBytes: number;

  constructor(@Inject(SERVICE_CONFIGURATION) configuration: ServiceConfiguration) {
    this.bodyLimitBytes = configuration.server.jsonBodyLimitBytes;
    this.parseJsonBody = express.json({ limit: this.bodyLimitBytes, strict: true });
  }

  use(request: Request, response: Response, next: NextFunction): void {
    this.parseJsonBody(request, response, (parseError?: unknown) => {
      if (parseError === undefined) {
        next();
        return;
      }
      const errorType = (parseError as { type?: unknown }).type;
      const knownError = typeof errorType === 'string' ? BODY_PARSER_ERRORS[errorType] : undefined;
      next(
        knownError === undefined
          ? parseError
          : new ApplicationError(
              knownError.status,
              knownError.code,
              knownError.code === 'payload_too_large'
                ? `${knownError.message} Limit: ${this.bodyLimitBytes} bytes.`
                : knownError.message,
            ),
      );
    });
  }
}
