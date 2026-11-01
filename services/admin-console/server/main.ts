/** Process entry point: validate configuration, serve, and shut down gracefully. */
import { buildApp } from './app.ts';
import { InvalidConfigurationError, loadConfig } from './config.ts';

const SHUTDOWN_TIMEOUT_MILLISECONDS = 10_000;

function readConfig() {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof InvalidConfigurationError)) throw error;
    process.stderr.write(`admin-console refused to start:\n  ${error.invalidVariables.join('\n  ')}\n`);
    process.exit(1);
  }
}

const config = readConfig();
const app = buildApp(config);

async function shutDown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  const forcedExit = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MILLISECONDS);
  forcedExit.unref();
  await app.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutDown('SIGTERM'));
process.once('SIGINT', () => void shutDown('SIGINT'));

await app.listen({ host: config.server.host, port: config.server.port });
