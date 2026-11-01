/**
 * Service configuration loaded from `RAG_*` environment variables.
 *
 * Every variable is namespaced with the `RAG_` prefix so this service can share
 * a shell, `.env` file or deployment environment with other monorepo services without
 * collisions. For example, the `databaseUrl` field is read from `RAG_DATABASE_URL`.
 *
 * The configuration is validated once at startup; any invalid or missing value stops
 * the process with a message naming every offending variable.
 */
import { z } from 'zod';

import { SecretValue } from './secret-value.js';

const ENVIRONMENT_VARIABLE_PREFIX = 'RAG_';

const DEPLOYMENT_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
const LOG_FORMATS = ['text', 'json'] as const;

export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFormat = (typeof LOG_FORMATS)[number];

/** Empty strings mean "not set", so `VAR=` in a `.env` file falls back to the default. */
const emptyAsUndefined = (rawValue: unknown): unknown =>
  typeof rawValue === 'string' && rawValue.trim() === '' ? undefined : rawValue;

const optionalText = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(emptyAsUndefined, schema.optional());

const booleanFlag = (defaultValue: boolean) =>
  z.preprocess(emptyAsUndefined, z.stringbool().default(defaultValue));

const integerInRange = (defaultValue: number, minimum: number, maximum: number) =>
  z.preprocess(emptyAsUndefined, z.coerce.number().int().min(minimum).max(maximum).default(defaultValue));

const numberInRange = (defaultValue: number, minimum: number, maximum: number) =>
  z.preprocess(emptyAsUndefined, z.coerce.number().min(minimum).max(maximum).default(defaultValue));

const secret = (minimumLength = 1) =>
  z
    .string()
    .trim()
    .min(minimumLength, `must be at least ${minimumLength} non-whitespace characters long`)
    .transform((secretText) => new SecretValue(secretText));

const urlWithProtocols = (allowedProtocols: readonly string[]) =>
  z.url().refine((urlText) => allowedProtocols.includes(new URL(urlText).protocol), {
    message: `must use one of: ${allowedProtocols.join(', ')}`,
  });

const secretUrlWithProtocols = (allowedProtocols: readonly string[]) =>
  urlWithProtocols(allowedProtocols).transform((urlText) => new SecretValue(urlText));

const httpUrl = () => urlWithProtocols(['http:', 'https:']);

/** Comma-separated list; blanks are dropped, so an empty variable means "none". */
const commaSeparatedList = <Schema extends z.ZodType>(itemSchema: Schema) =>
  z.preprocess(
    (rawValue) =>
      typeof rawValue === 'string'
        ? rawValue
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item !== '')
        : rawValue,
    z.array(itemSchema).default([]),
  );

const ADMIN_PASSWORD_HASH_PATTERN = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;
const MEBIBYTE = 1024 * 1024;
const DAY_IN_SECONDS = 24 * 60 * 60;

const environmentVariablesSchema = z.object({
  // ----- HTTP server -----
  ENVIRONMENT: z.preprocess(emptyAsUndefined, z.enum(DEPLOYMENT_ENVIRONMENTS).default('production')),
  HOST: z.preprocess(emptyAsUndefined, z.string().default('0.0.0.0')),
  PORT: integerInRange(8080, 1, 65_535),
  ENABLE_API_DOCS: booleanFlag(false),
  JSON_BODY_LIMIT_BYTES: integerInRange(1024 * 1024, 1024, 64 * 1024 * 1024),
  GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS: numberInRange(30, 1, 600),

  // ----- Logging -----
  LOG_LEVEL: z.preprocess(
    (rawValue) => (typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : rawValue),
    z.preprocess(emptyAsUndefined, z.enum(LOG_LEVELS).default('info')),
  ),
  LOG_FORMAT: z.preprocess(emptyAsUndefined, z.enum(LOG_FORMATS).default('json')),

  // ----- PostgreSQL -----
  DATABASE_URL: secretUrlWithProtocols(['postgres:', 'postgresql:']),
  DATABASE_POOL_SIZE: integerInRange(10, 1, 200),
  DATABASE_STATEMENT_TIMEOUT_MILLISECONDS: integerInRange(30_000, 100, 600_000),

  // ----- Redis (BullMQ queues, rate limits) -----
  REDIS_URL: secretUrlWithProtocols(['redis:', 'rediss:']),
  // Namespace for every key this service writes, so it can share a Redis with other services.
  REDIS_KEY_PREFIX: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,62}$/, 'must be a lowercase slug')
      .default('rag'),
  ),

  // ----- S3-compatible object storage (MinIO locally) -----
  S3_ENDPOINT: optionalText(httpUrl()),
  S3_REGION: z.preprocess(emptyAsUndefined, z.string().default('us-east-1')),
  S3_BUCKET: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid S3 bucket name'),
  S3_ACCESS_KEY_ID: secret(),
  S3_SECRET_ACCESS_KEY: secret(),
  // MinIO requires path-style URLs (http://host/bucket/key).
  S3_FORCE_PATH_STYLE: booleanFlag(true),

  // ----- Dependency checks -----
  DEPENDENCY_CHECK_TIMEOUT_MILLISECONDS: integerInRange(2_000, 100, 30_000),

  // ----- embedding-server -----
  EMBEDDING_SERVER_URL: httpUrl(),
  EMBEDDING_SERVER_API_KEY: secret(16),
  EMBEDDING_SERVER_TIMEOUT_MILLISECONDS: integerInRange(120_000, 1_000, 600_000),
  // The server accepts at most 64 items per request.
  EMBEDDING_BATCH_SIZE: integerInRange(32, 1, 64),

  // ----- llm-gateway -----
  LLM_GATEWAY_URL: httpUrl(),
  LLM_GATEWAY_API_KEY: secret(16),
  // Whole-request limit for non-streamed calls; streams use the idle timeout instead.
  LLM_GATEWAY_TIMEOUT_MILLISECONDS: integerInRange(120_000, 1_000, 900_000),
  LLM_GATEWAY_STREAM_IDLE_TIMEOUT_MILLISECONDS: integerInRange(60_000, 1_000, 600_000),
  LLM_TASK_LIMITS_CACHE_SECONDS: integerInRange(60, 0, 3_600),
  // Query rewriting is skipped (the raw question is searched) when it takes longer.
  QUERY_REWRITE_TIMEOUT_MILLISECONDS: integerInRange(20_000, 500, 120_000),

  // ----- Admin API -----
  ADMIN_BOOTSTRAP_USERNAME: optionalText(z.string().trim().min(1).max(128)),
  // Produced by `npm run admin:hash-password`; format scrypt$N$r$p$salt$hash.
  ADMIN_BOOTSTRAP_PASSWORD_HASH: optionalText(
    z
      .string()
      .trim()
      .regex(ADMIN_PASSWORD_HASH_PATTERN, 'must be a scrypt hash from `npm run admin:hash-password`')
      .transform((hashText) => new SecretValue(hashText)),
  ),
  // Service credential for the admin console backend (Authorization: Bearer); optional.
  ADMIN_API_KEY: optionalText(secret(32)),
  ADMIN_SESSION_TTL_SECONDS: integerInRange(12 * 60 * 60, 300, 30 * DAY_IN_SECONDS),
  ADMIN_COOKIE_SECURE: booleanFlag(true),

  // ----- Public chat access -----
  // HMAC key for IP addresses and device fingerprints; they are never stored in clear.
  CLIENT_HASH_SECRET: secret(32),
  PUBLIC_CORS_ALLOWED_ORIGINS: commaSeparatedList(z.url()),
  // Reverse proxies in front of the service whose X-Forwarded-For entries are trusted.
  TRUSTED_PROXY_HOPS: integerInRange(0, 0, 10),
  VISITOR_SESSION_TTL_SECONDS: integerInRange(30 * DAY_IN_SECONDS, 3_600, 365 * DAY_IN_SECONDS),
  TURNSTILE_SITE_KEY: optionalText(z.string().trim().min(1)),
  TURNSTILE_SECRET_KEY: optionalText(secret()),
  RATE_LIMIT_TURNS_PER_MINUTE_PER_SESSION: integerInRange(6, 1, 1_000),
  RATE_LIMIT_TURNS_PER_MINUTE_PER_FINGERPRINT: integerInRange(10, 1, 1_000),
  RATE_LIMIT_TURNS_PER_MINUTE_PER_IP: integerInRange(30, 1, 10_000),
  RATE_LIMIT_SESSIONS_PER_HOUR_PER_IP: integerInRange(20, 1, 10_000),
  RATE_LIMIT_REQUESTS_PER_MINUTE_PER_IP: integerInRange(300, 1, 100_000),
  // Total gateway tokens (input + output) all visitors may spend per UTC day; 0 = unlimited.
  DAILY_TOKEN_BUDGET: integerInRange(2_000_000, 0, 1_000_000_000),

  // ----- Ingestion -----
  MAX_UPLOAD_BYTES: integerInRange(50 * MEBIBYTE, 1_024, 1_024 * MEBIBYTE),
  MAX_PAGES_PER_DOCUMENT: integerInRange(200, 1, 5_000),
  PARSE_PAGES_PER_JOB: integerInRange(8, 1, 64),
  PARSE_PAGE_TIMEOUT_SECONDS: integerInRange(900, 10, 3_600),
  PARSE_RENDER_DPI: integerInRange(144, 72, 400),
  MAX_VISION_MODEL_CALLS_PER_DOCUMENT: integerInRange(500, 0, 10_000),
  WORKER_CONCURRENCY: integerInRange(2, 1, 32),

  // ----- Chat -----
  MAX_ATTACHMENT_BYTES: integerInRange(5 * MEBIBYTE, 1_024, 20 * MEBIBYTE),
  // Token counts are estimated with o200k_base and inflated by this factor, because the
  // serving model's tokenizer is unknown and may split (especially Bengali) text finer.
  TOKEN_ESTIMATE_SAFETY_FACTOR: numberInRange(1.2, 1, 3),

  // ----- Data retention (hourly maintenance job in the worker) -----
  MAINTENANCE_INTERVAL_MINUTES: integerInRange(60, 1, 24 * 60),
  // Conversations stay browsable by admins this long after their visitor session expired.
  VISITOR_DATA_RETENTION_DAYS: integerInRange(90, 1, 3_650),
  RETRIEVAL_TRACE_RETENTION_DAYS: integerInRange(30, 1, 3_650),
});

export interface ServiceConfiguration {
  readonly server: {
    readonly environment: DeploymentEnvironment;
    readonly host: string;
    readonly port: number;
    readonly enableApiDocs: boolean;
    readonly jsonBodyLimitBytes: number;
    readonly gracefulShutdownTimeoutSeconds: number;
  };
  readonly observability: {
    readonly logLevel: LogLevel;
    readonly logFormat: LogFormat;
  };
  readonly database: {
    readonly url: SecretValue;
    readonly poolSize: number;
    readonly statementTimeoutMilliseconds: number;
  };
  readonly redis: {
    readonly url: SecretValue;
    readonly keyPrefix: string;
  };
  readonly objectStorage: {
    readonly endpoint: string | undefined;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: SecretValue;
    readonly secretAccessKey: SecretValue;
    readonly forcePathStyle: boolean;
  };
  readonly dependencyCheckTimeoutMilliseconds: number;
  readonly embeddingServer: {
    readonly url: string;
    readonly apiKey: SecretValue;
    readonly timeoutMilliseconds: number;
    readonly batchSize: number;
  };
  readonly llmGateway: {
    readonly url: string;
    readonly apiKey: SecretValue;
    readonly timeoutMilliseconds: number;
    readonly streamIdleTimeoutMilliseconds: number;
    readonly taskLimitsCacheSeconds: number;
    readonly queryRewriteTimeoutMilliseconds: number;
  };
  readonly admin: {
    readonly bootstrapAccount: { readonly username: string; readonly passwordHash: SecretValue } | undefined;
    readonly apiKey: SecretValue | undefined;
    readonly sessionTtlSeconds: number;
    readonly cookieSecure: boolean;
  };
  readonly publicAccess: {
    readonly clientHashSecret: SecretValue;
    readonly corsAllowedOrigins: readonly string[];
    readonly trustedProxyHops: number;
    readonly visitorSessionTtlSeconds: number;
    readonly turnstile: { readonly siteKey: string; readonly secretKey: SecretValue } | undefined;
    readonly rateLimits: {
      readonly turnsPerMinutePerSession: number;
      readonly turnsPerMinutePerFingerprint: number;
      readonly turnsPerMinutePerIp: number;
      readonly sessionsPerHourPerIp: number;
      readonly requestsPerMinutePerIp: number;
    };
    readonly dailyTokenBudget: number;
  };
  readonly ingestion: {
    readonly maxUploadBytes: number;
    readonly maxPagesPerDocument: number;
    readonly parsePagesPerJob: number;
    readonly parsePageTimeoutSeconds: number;
    readonly parseRenderDpi: number;
    readonly maxVisionModelCallsPerDocument: number;
    readonly workerConcurrency: number;
  };
  readonly chat: {
    readonly maxAttachmentBytes: number;
    readonly tokenEstimateSafetyFactor: number;
  };
  readonly retention: {
    readonly maintenanceIntervalMinutes: number;
    readonly visitorDataRetentionDays: number;
    readonly retrievalTraceRetentionDays: number;
  };
}

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

/** Selects the `RAG_*` variables and strips the prefix. */
function extractPrefixedVariables(environment: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const prefixedVariables: Record<string, string | undefined> = {};
  for (const [variableName, variableValue] of Object.entries(environment)) {
    if (variableName.startsWith(ENVIRONMENT_VARIABLE_PREFIX)) {
      prefixedVariables[variableName.slice(ENVIRONMENT_VARIABLE_PREFIX.length)] = variableValue;
    }
  }
  return prefixedVariables;
}

function describeValidationIssues(validationError: z.ZodError): string {
  return validationError.issues
    .map((issue) => `  - ${ENVIRONMENT_VARIABLE_PREFIX}${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
}

/**
 * Parses and validates configuration from an environment map. Pure and side-effect free,
 * so tests can pass an explicit map instead of mutating `process.env`.
 */
export function parseConfiguration(environment: NodeJS.ProcessEnv): ServiceConfiguration {
  const parseResult = environmentVariablesSchema.safeParse(extractPrefixedVariables(environment));
  if (!parseResult.success) {
    throw new ConfigurationError(`Invalid configuration:\n${describeValidationIssues(parseResult.error)}`);
  }
  const variables = parseResult.data;
  assertPairedVariables(variables);
  return Object.freeze({
    server: Object.freeze({
      environment: variables.ENVIRONMENT,
      host: variables.HOST,
      port: variables.PORT,
      enableApiDocs: variables.ENABLE_API_DOCS,
      jsonBodyLimitBytes: variables.JSON_BODY_LIMIT_BYTES,
      gracefulShutdownTimeoutSeconds: variables.GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS,
    }),
    observability: Object.freeze({
      logLevel: variables.LOG_LEVEL,
      logFormat: variables.LOG_FORMAT,
    }),
    database: Object.freeze({
      url: variables.DATABASE_URL,
      poolSize: variables.DATABASE_POOL_SIZE,
      statementTimeoutMilliseconds: variables.DATABASE_STATEMENT_TIMEOUT_MILLISECONDS,
    }),
    redis: Object.freeze({
      url: variables.REDIS_URL,
      keyPrefix: variables.REDIS_KEY_PREFIX,
    }),
    objectStorage: Object.freeze({
      endpoint: variables.S3_ENDPOINT,
      region: variables.S3_REGION,
      bucket: variables.S3_BUCKET,
      accessKeyId: variables.S3_ACCESS_KEY_ID,
      secretAccessKey: variables.S3_SECRET_ACCESS_KEY,
      forcePathStyle: variables.S3_FORCE_PATH_STYLE,
    }),
    dependencyCheckTimeoutMilliseconds: variables.DEPENDENCY_CHECK_TIMEOUT_MILLISECONDS,
    embeddingServer: Object.freeze({
      url: withoutTrailingSlash(variables.EMBEDDING_SERVER_URL),
      apiKey: variables.EMBEDDING_SERVER_API_KEY,
      timeoutMilliseconds: variables.EMBEDDING_SERVER_TIMEOUT_MILLISECONDS,
      batchSize: variables.EMBEDDING_BATCH_SIZE,
    }),
    llmGateway: Object.freeze({
      url: withoutTrailingSlash(variables.LLM_GATEWAY_URL),
      apiKey: variables.LLM_GATEWAY_API_KEY,
      timeoutMilliseconds: variables.LLM_GATEWAY_TIMEOUT_MILLISECONDS,
      streamIdleTimeoutMilliseconds: variables.LLM_GATEWAY_STREAM_IDLE_TIMEOUT_MILLISECONDS,
      taskLimitsCacheSeconds: variables.LLM_TASK_LIMITS_CACHE_SECONDS,
      queryRewriteTimeoutMilliseconds: variables.QUERY_REWRITE_TIMEOUT_MILLISECONDS,
    }),
    admin: Object.freeze({
      bootstrapAccount:
        variables.ADMIN_BOOTSTRAP_USERNAME === undefined ||
        variables.ADMIN_BOOTSTRAP_PASSWORD_HASH === undefined
          ? undefined
          : Object.freeze({
              username: variables.ADMIN_BOOTSTRAP_USERNAME,
              passwordHash: variables.ADMIN_BOOTSTRAP_PASSWORD_HASH,
            }),
      apiKey: variables.ADMIN_API_KEY,
      sessionTtlSeconds: variables.ADMIN_SESSION_TTL_SECONDS,
      cookieSecure: variables.ADMIN_COOKIE_SECURE,
    }),
    publicAccess: Object.freeze({
      clientHashSecret: variables.CLIENT_HASH_SECRET,
      corsAllowedOrigins: Object.freeze(variables.PUBLIC_CORS_ALLOWED_ORIGINS.map(withoutTrailingSlash)),
      trustedProxyHops: variables.TRUSTED_PROXY_HOPS,
      visitorSessionTtlSeconds: variables.VISITOR_SESSION_TTL_SECONDS,
      turnstile:
        variables.TURNSTILE_SITE_KEY === undefined || variables.TURNSTILE_SECRET_KEY === undefined
          ? undefined
          : Object.freeze({
              siteKey: variables.TURNSTILE_SITE_KEY,
              secretKey: variables.TURNSTILE_SECRET_KEY,
            }),
      rateLimits: Object.freeze({
        turnsPerMinutePerSession: variables.RATE_LIMIT_TURNS_PER_MINUTE_PER_SESSION,
        turnsPerMinutePerFingerprint: variables.RATE_LIMIT_TURNS_PER_MINUTE_PER_FINGERPRINT,
        turnsPerMinutePerIp: variables.RATE_LIMIT_TURNS_PER_MINUTE_PER_IP,
        sessionsPerHourPerIp: variables.RATE_LIMIT_SESSIONS_PER_HOUR_PER_IP,
        requestsPerMinutePerIp: variables.RATE_LIMIT_REQUESTS_PER_MINUTE_PER_IP,
      }),
      dailyTokenBudget: variables.DAILY_TOKEN_BUDGET,
    }),
    ingestion: Object.freeze({
      maxUploadBytes: variables.MAX_UPLOAD_BYTES,
      maxPagesPerDocument: variables.MAX_PAGES_PER_DOCUMENT,
      parsePagesPerJob: variables.PARSE_PAGES_PER_JOB,
      parsePageTimeoutSeconds: variables.PARSE_PAGE_TIMEOUT_SECONDS,
      parseRenderDpi: variables.PARSE_RENDER_DPI,
      maxVisionModelCallsPerDocument: variables.MAX_VISION_MODEL_CALLS_PER_DOCUMENT,
      workerConcurrency: variables.WORKER_CONCURRENCY,
    }),
    chat: Object.freeze({
      maxAttachmentBytes: variables.MAX_ATTACHMENT_BYTES,
      tokenEstimateSafetyFactor: variables.TOKEN_ESTIMATE_SAFETY_FACTOR,
    }),
    retention: Object.freeze({
      maintenanceIntervalMinutes: variables.MAINTENANCE_INTERVAL_MINUTES,
      visitorDataRetentionDays: variables.VISITOR_DATA_RETENTION_DAYS,
      retrievalTraceRetentionDays: variables.RETRIEVAL_TRACE_RETENTION_DAYS,
    }),
  });
}

const withoutTrailingSlash = (urlText: string): string => urlText.replace(/\/+$/, '');

type ParsedVariables = z.infer<typeof environmentVariablesSchema>;

/** Variables that only make sense together: setting one without the other is a mistake. */
const PAIRED_VARIABLES: readonly (readonly [keyof ParsedVariables, keyof ParsedVariables])[] = [
  ['ADMIN_BOOTSTRAP_USERNAME', 'ADMIN_BOOTSTRAP_PASSWORD_HASH'],
  ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
];

function assertPairedVariables(variables: ParsedVariables): void {
  const unpairedMessages = PAIRED_VARIABLES.filter(
    ([firstName, secondName]) =>
      (variables[firstName] === undefined) !== (variables[secondName] === undefined),
  ).map(
    ([firstName, secondName]) =>
      `  - ${ENVIRONMENT_VARIABLE_PREFIX}${firstName} and ${ENVIRONMENT_VARIABLE_PREFIX}${secondName} must be set together`,
  );
  if (unpairedMessages.length > 0) {
    throw new ConfigurationError(`Invalid configuration:\n${unpairedMessages.join('\n')}`);
  }
}

let cachedConfiguration: ServiceConfiguration | undefined;

/** Returns the process-wide configuration, parsing the environment exactly once. */
export function loadConfiguration(): ServiceConfiguration {
  cachedConfiguration ??= parseConfiguration(process.env);
  return cachedConfiguration;
}
