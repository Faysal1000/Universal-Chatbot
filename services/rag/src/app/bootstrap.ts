import { type DynamicModule, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoBackedLogger } from 'nestjs-pino';

import { errorMessageOf } from '../common/errors/error-message.js';
import type { ProcessRole } from '../common/process-role.js';
import { SERVICE_VERSION } from '../common/service-version.js';
import { loadConfiguration, type ServiceConfiguration } from '../config/configuration.js';
import { configureHttpApplication } from './http-application.js';

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

function writeFatal(message: string, details: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ level: 'fatal', message, ...details })}\n`);
}

function loadConfigurationOrExit(): ServiceConfiguration {
  try {
    return loadConfiguration();
  } catch (error: unknown) {
    writeFatal('Invalid configuration; refusing to start', {
      error: errorMessageOf(error),
    });
    process.exit(1);
  }
}

/**
 * Closes the application once on SIGTERM/SIGINT: readiness fails first, in-flight
 * work drains, then connections close. A hard deadline guarantees
 * the process exits even if a dependency hangs.
 */
function installGracefulShutdown(
  application: NestExpressApplication,
  logger: Logger,
  shutdownTimeoutSeconds: number,
): void {
  let isShuttingDown = false;
  const shutDown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.log({ signal }, 'Shutdown signal received; draining');
    const forcedExitTimer = setTimeout(() => {
      writeFatal('Graceful shutdown timed out; forcing exit', { shutdownTimeoutSeconds });
      process.exit(1);
    }, shutdownTimeoutSeconds * 1_000);
    forcedExitTimer.unref();
    try {
      await application.close();
      process.exit(0);
    } catch (error: unknown) {
      writeFatal('Error during shutdown', { error: errorMessageOf(error) });
      process.exit(1);
    }
  };
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, (receivedSignal: NodeJS.Signals) => void shutDown(receivedSignal));
  }
}

/** Starts one process of the service (`api` or `worker`) and serves HTTP on the configured port. */
export async function startProcess(
  processRole: ProcessRole,
  buildRootModule: (configuration: ServiceConfiguration) => DynamicModule,
): Promise<void> {
  const configuration = loadConfigurationOrExit();
  const application = await NestFactory.create<NestExpressApplication>(buildRootModule(configuration), {
    bufferLogs: true,
    // JSON parsing runs as Nest middleware so its errors become problem+json responses.
    bodyParser: false,
    abortOnError: false,
  });
  application.useLogger(application.get(PinoBackedLogger));
  const logger = new Logger('Bootstrap');
  configureHttpApplication(application, configuration, processRole);
  installGracefulShutdown(application, logger, configuration.server.gracefulShutdownTimeoutSeconds);

  await application.listen(configuration.server.port, configuration.server.host);
  logger.log(
    {
      processRole,
      version: SERVICE_VERSION,
      environment: configuration.server.environment,
      port: configuration.server.port,
    },
    'rag started',
  );
}

export function exitOnStartupFailure(error: unknown): never {
  writeFatal('Startup failed', {
    error: errorMessageOf(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
}
