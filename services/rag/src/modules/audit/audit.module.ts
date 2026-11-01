import { Global, Module } from '@nestjs/common';

import { AuditEventsRepository } from './audit-events.repository.js';

@Global()
@Module({ providers: [AuditEventsRepository], exports: [AuditEventsRepository] })
export class AuditModule {}
