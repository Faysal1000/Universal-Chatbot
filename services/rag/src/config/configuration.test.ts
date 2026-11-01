import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { validTestEnvironment } from '../../test/support/test-environment.js';
import { ConfigurationError, parseConfiguration } from './configuration.js';

describe('parseConfiguration', () => {
  it('applies documented defaults when optional variables are absent', () => {
    const configuration = parseConfiguration(validTestEnvironment());

    expect(configuration.server).toMatchObject({
      host: '0.0.0.0',
      port: 8080,
      enableApiDocs: false,
      jsonBodyLimitBytes: 1024 * 1024,
    });
    expect(configuration.redis.keyPrefix).toBe('rag');
    expect(configuration.publicAccess.turnstile).toBeUndefined();
    expect(configuration.retention).toEqual({
      maintenanceIntervalMinutes: 60,
      visitorDataRetentionDays: 90,
      retrievalTraceRetentionDays: 30,
    });
  });

  it('treats empty strings as unset so `VAR=` in .env files falls back to defaults', () => {
    const configuration = parseConfiguration(
      validTestEnvironment({
        RAG_PORT: '',
        RAG_TURNSTILE_SECRET_KEY: ' ',
      }),
    );

    expect(configuration.server.port).toBe(8080);
    expect(configuration.publicAccess.turnstile).toBeUndefined();
  });

  it('parses booleans, numbers and normalises trailing slashes', () => {
    const configuration = parseConfiguration(
      validTestEnvironment({
        RAG_ENABLE_API_DOCS: 'true',
        RAG_PORT: '9090',
        RAG_EMBEDDING_SERVER_URL: 'http://embedding-server:8000/',
        RAG_LOG_LEVEL: 'DEBUG',
        RAG_VISITOR_DATA_RETENTION_DAYS: '14',
      }),
    );

    expect(configuration.retention.visitorDataRetentionDays).toBe(14);

    expect(configuration.server.enableApiDocs).toBe(true);
    expect(configuration.server.port).toBe(9090);
    expect(configuration.embeddingServer.url).toBe('http://embedding-server:8000');
    expect(configuration.observability.logLevel).toBe('debug');
  });

  it('ignores variables without the service prefix', () => {
    const configuration = parseConfiguration(
      validTestEnvironment({ PORT: '1234', LLM_GATEWAY_PORT: '4000' }),
    );

    expect(configuration.server.port).toBe(8080);
  });

  it('reports every invalid or missing variable at once, with its full name', () => {
    const environment = validTestEnvironment({
      RAG_DATABASE_URL: 'mysql://localhost/rag',
      RAG_PORT: '70000',
      RAG_S3_BUCKET: undefined,
    });

    expect(() => parseConfiguration(environment)).toThrow(ConfigurationError);
    try {
      parseConfiguration(environment);
    } catch (error: unknown) {
      const message = (error as Error).message;
      expect(message).toContain('RAG_DATABASE_URL');
      expect(message).toContain('RAG_PORT');
      expect(message).toContain('RAG_S3_BUCKET');
    }
  });

  it('never exposes secrets through serialisation, string conversion or inspection', () => {
    const configuration = parseConfiguration(validTestEnvironment());
    const databaseUrl = configuration.database.url;

    expect(JSON.stringify(configuration)).not.toContain('test-password');
    expect(String(databaseUrl)).toBe('[REDACTED]');
    expect(inspect(configuration, { depth: 5 })).not.toContain('test-secret-access-key');
    expect(databaseUrl.reveal()).toBe('postgresql://rag:test-password@localhost:5432/rag');
  });

  it('returns a deeply frozen object', () => {
    const configuration = parseConfiguration(validTestEnvironment());

    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.server)).toBe(true);
  });
});
