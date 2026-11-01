import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { validTestEnvironment } from '../../../test/support/test-environment.js';
import { parseConfiguration } from '../../config/configuration.js';
import { AdminAuthenticationGuard } from './admin-authentication.guard.js';
import { auditActorOf } from './admin-principal.js';
import type { AdminSessionsService } from './admin-sessions.service.js';

const API_KEY = 'test-admin-api-key-0123456789abcdef';

function guard(): AdminAuthenticationGuard {
  const configuration = parseConfiguration(validTestEnvironment({ RAG_ADMIN_API_KEY: API_KEY }));
  return new AdminAuthenticationGuard({} as AdminSessionsService, configuration);
}

async function authenticate(headers: Record<string, string>): Promise<Request> {
  const request = { method: 'POST', headers: { authorization: `Bearer ${API_KEY}`, ...headers } } as Request;
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
  await guard().canActivate(context);
  return request;
}

describe('AdminAuthenticationGuard with the service API key', () => {
  it('records the console user named in X-Admin-Actor as the audit actor', async () => {
    const request = await authenticate({ 'x-admin-actor': ' operator ' });

    expect(request.adminPrincipal && auditActorOf(request.adminPrincipal)).toEqual({
      adminUserId: null,
      username: 'operator',
    });
  });

  it('leaves the actor unknown without the header', async () => {
    const request = await authenticate({});

    expect(request.adminPrincipal && auditActorOf(request.adminPrincipal)).toEqual({
      adminUserId: null,
      username: null,
    });
  });

  it('rejects an actor name with control characters', async () => {
    await expect(authenticate({ 'x-admin-actor': 'evil\nname' })).rejects.toMatchObject({
      httpStatus: 422,
      code: 'validation_failed',
    });
  });
});
