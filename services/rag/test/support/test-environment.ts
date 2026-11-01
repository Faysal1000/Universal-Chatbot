/** A complete, valid `RAG_*` environment for tests. Override single keys per test. */
export function validTestEnvironment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    RAG_ENVIRONMENT: 'development',
    RAG_DATABASE_URL: 'postgresql://rag:test-password@localhost:5432/rag',
    RAG_REDIS_URL: 'redis://rag:test-password@localhost:6379/0',
    RAG_S3_ENDPOINT: 'http://localhost:9000',
    RAG_S3_BUCKET: 'rag',
    RAG_S3_ACCESS_KEY_ID: 'rag-test',
    RAG_S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
    RAG_EMBEDDING_SERVER_URL: 'http://localhost:8000',
    RAG_EMBEDDING_SERVER_API_KEY: 'test-embedding-server-api-key',
    RAG_LLM_GATEWAY_URL: 'http://localhost:4000',
    RAG_LLM_GATEWAY_API_KEY: 'test-llm-gateway-api-key',
    RAG_CLIENT_HASH_SECRET: 'test-client-hash-secret-with-32-characters',
    RAG_LOG_LEVEL: 'error',
    ...overrides,
  };
}
