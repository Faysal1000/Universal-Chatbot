import { Controller, Get, Header, HttpCode, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { HealthService, type ReadinessReport } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** The process is running and its event loop responds. Restart it if this fails. */
  @Get('live')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Process is alive.', schema: { example: { status: 'alive' } } })
  liveness(): { status: 'alive' } {
    return { status: 'alive' };
  }

  /** Every dependency is reachable. Route traffic (or pick up jobs) only when this is 200. */
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'All dependencies are reachable.',
    schema: {
      example: {
        status: 'ready',
        checks: { postgres: 'up', redis: 'up', object_storage: 'up' },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'A dependency is unreachable or the process is shutting down.',
  })
  async readiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessReport> {
    const readinessReport = await this.healthService.checkReadiness();
    response.status(readinessReport.status === 'ready' ? 200 : 503);
    return readinessReport;
  }
}
