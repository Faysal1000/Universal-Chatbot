/**
 * Configuration from `ADMIN_CONSOLE_*` environment variables, validated once at startup.
 * The process refuses to start on any invalid value and names every offending variable.
 */
import { z } from 'zod';

import { isPasswordHash } from './security/passwordHash.ts';

const ENVIRONMENT_VARIABLE_PREFIX = 'ADMIN_CONSOLE_';
const MINIMUM_SERVICE_KEY_LENGTH = 32;

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');
const httpUrl = z
  .url({ protocol: /^https?$/ })
  .transform((value) => value.replace(/\/+$/, ''))
  .describe('an http(s) URL without a path suffix');
const serviceKey = z.string().trim().min(MINIMUM_SERVICE_KEY_LENGTH);
const optionalHttpUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value))
  .pipe(httpUrl.optional());

const environmentSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: booleanFromString.default(false),
  STATIC_DIRECTORY: z.string().default('dist/web'),

  ADMIN_USERNAME: z.string().trim().min(1).max(128),
  ADMIN_PASSWORD_HASH: z.string().refine(isPasswordHash, 'must come from `npm run hash-password`'),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(7 * 24 * 3600)
    .default(12 * 3600),
  SESSION_IDLE_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(24 * 3600)
    .default(2 * 3600),
  COOKIE_SECURE: booleanFromString.default(true),
  LOGIN_MAX_FAILURES_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(5),

  LLM_GATEWAY_URL: httpUrl,
  LLM_GATEWAY_ADMIN_API_KEY: serviceKey,
  RAG_URL: httpUrl,
  RAG_ADMIN_API_KEY: serviceKey,
  RAG_WORKER_URL: optionalHttpUrl,
  LOCAL_LLM_URL: httpUrl,
  LOCAL_LLM_ADMIN_API_KEY: serviceKey,
  EMBEDDING_SERVER_URL: httpUrl,
  DOCUMENT_PARSER_URL: optionalHttpUrl,

  UPSTREAM_TIMEOUT_SECONDS: z.coerce.number().min(1).max(600).default(60),
  HEALTH_CHECK_TIMEOUT_SECONDS: z.coerce.number().min(0.5).max(30).default(3),
});

type Environment = z.infer<typeof environmentSchema>;

interface ServiceCredentials {
  readonly baseUrl: string;
  readonly adminApiKey: string;
}

export interface ConsoleConfig {
  readonly server: { host: string; port: number; logLevel: Environment['LOG_LEVEL']; trustProxy: boolean };
  readonly staticDirectory: string;
  readonly admin: { username: string; passwordHash: string };
  readonly session: {
    ttlSeconds: number;
    idleTimeoutSeconds: number;
    cookieSecure: boolean;
    loginMaxFailuresPerMinute: number;
  };
  readonly services: {
    llmGateway: ServiceCredentials;
    rag: ServiceCredentials & { workerUrl: string | undefined };
    localLlm: ServiceCredentials;
    embeddingServerUrl: string;
    documentParserUrl: string | undefined;
  };
  readonly timeouts: { upstreamMilliseconds: number; healthCheckMilliseconds: number };
}

export class InvalidConfigurationError extends Error {
  readonly invalidVariables: string[];

  constructor(invalidVariables: string[]) {
    super(`Invalid configuration: ${invalidVariables.join('; ')}`);
    this.invalidVariables = invalidVariables;
    this.name = 'InvalidConfigurationError';
  }
}

/** Reads every `ADMIN_CONSOLE_*` variable; throws naming each invalid one. */
export function loadConfig(environment: NodeJS.ProcessEnv): ConsoleConfig {
  const parsed = environmentSchema.safeParse(stripPrefix(environment));
  if (!parsed.success) {
    throw new InvalidConfigurationError(
      parsed.error.issues.map((issue) => `${ENVIRONMENT_VARIABLE_PREFIX}${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return toConsoleConfig(parsed.data);
}

function stripPrefix(environment: NodeJS.ProcessEnv): Record<string, string> {
  const prefixed: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (name.startsWith(ENVIRONMENT_VARIABLE_PREFIX) && value !== undefined) {
      prefixed[name.slice(ENVIRONMENT_VARIABLE_PREFIX.length)] = value;
    }
  }
  return prefixed;
}

function toConsoleConfig(environment: Environment): ConsoleConfig {
  return {
    server: {
      host: environment.HOST,
      port: environment.PORT,
      logLevel: environment.LOG_LEVEL,
      trustProxy: environment.TRUST_PROXY,
    },
    staticDirectory: environment.STATIC_DIRECTORY,
    admin: { username: environment.ADMIN_USERNAME, passwordHash: environment.ADMIN_PASSWORD_HASH },
    session: {
      ttlSeconds: environment.SESSION_TTL_SECONDS,
      idleTimeoutSeconds: environment.SESSION_IDLE_TIMEOUT_SECONDS,
      cookieSecure: environment.COOKIE_SECURE,
      loginMaxFailuresPerMinute: environment.LOGIN_MAX_FAILURES_PER_MINUTE,
    },
    services: {
      llmGateway: { baseUrl: environment.LLM_GATEWAY_URL, adminApiKey: environment.LLM_GATEWAY_ADMIN_API_KEY },
      rag: {
        baseUrl: environment.RAG_URL,
        adminApiKey: environment.RAG_ADMIN_API_KEY,
        workerUrl: environment.RAG_WORKER_URL,
      },
      localLlm: { baseUrl: environment.LOCAL_LLM_URL, adminApiKey: environment.LOCAL_LLM_ADMIN_API_KEY },
      embeddingServerUrl: environment.EMBEDDING_SERVER_URL,
      documentParserUrl: environment.DOCUMENT_PARSER_URL,
    },
    timeouts: {
      upstreamMilliseconds: environment.UPSTREAM_TIMEOUT_SECONDS * 1000,
      healthCheckMilliseconds: environment.HEALTH_CHECK_TIMEOUT_SECONDS * 1000,
    },
  };
}
