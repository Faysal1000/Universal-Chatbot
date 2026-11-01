import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApplicationError } from './application-error.js';
import { classifyError } from './problem-details.filter.js';

describe('classifyError', () => {
  it('maps a Nest 404 to route_not_found', () => {
    expect(classifyError(new NotFoundException('Cannot GET /nope'))).toEqual({
      status: 404,
      code: 'route_not_found',
      detail: 'Cannot GET /nope',
      isUnexpected: false,
    });
  });

  it('derives the code from the status text for other client errors', () => {
    expect(classifyError(new BadRequestException('bad input'))).toMatchObject({
      status: 400,
      code: 'bad_request',
      detail: 'bad input',
    });
  });

  it('keeps an application error as-is, including field errors and Retry-After', () => {
    const applicationError = new ApplicationError(
      429,
      'rate_limited',
      'Too many questions; try again shortly.',
      { fieldErrors: [{ field: 'message', message: 'too long' }], retryAfterSeconds: 30 },
    );

    expect(classifyError(applicationError)).toEqual({
      status: 429,
      code: 'rate_limited',
      detail: 'Too many questions; try again shortly.',
      fieldErrors: [{ field: 'message', message: 'too long' }],
      retryAfterSeconds: 30,
      isUnexpected: false,
    });
  });

  it('keeps the facts of an application error as details', () => {
    const duplicate = new ApplicationError(409, 'duplicate_document', 'Already uploaded.', {
      details: { existingDocumentId: 'document-1' },
    });

    expect(classifyError(duplicate)).toMatchObject({ details: { existingDocumentId: 'document-1' } });
  });

  it('maps exposed http-errors from Express middleware (e.g. body-parser)', () => {
    const payloadTooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
      expose: true,
    });

    expect(classifyError(payloadTooLarge)).toMatchObject({ status: 413, code: 'entity_too_large' });
  });

  it.each([
    ['a plain Error', new Error('database password is hunter2')],
    ['a Nest 500', new InternalServerErrorException('stack details')],
    ['a non-error value', 'boom'],
  ])('hides the details of %s behind a generic 500', (_description, exception) => {
    const classifiedError = classifyError(exception);

    expect(classifiedError.status).toBe(500);
    expect(classifiedError.code).toBe('internal_error');
    expect(classifiedError.isUnexpected).toBe(true);
    expect(classifiedError.detail).not.toMatch(/hunter2|stack details|boom/);
  });
});
