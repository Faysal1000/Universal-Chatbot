import { InvalidConfigurationError, loadConfig } from './config.ts';
import { buildTestConfig } from './testSupport/testServers.ts';

describe('loadConfig', () => {
  it('names every missing or invalid variable with its prefix', () => {
    const attempt = () => loadConfig({ ADMIN_CONSOLE_PORT: 'eighty', ADMIN_CONSOLE_RAG_URL: 'not a url' });

    expect(attempt).toThrow(InvalidConfigurationError);
    try {
      attempt();
    } catch (error) {
      const invalidVariables = (error as InvalidConfigurationError).invalidVariables.join('\n');
      expect(invalidVariables).toContain('ADMIN_CONSOLE_PORT');
      expect(invalidVariables).toContain('ADMIN_CONSOLE_RAG_URL');
      expect(invalidVariables).toContain('ADMIN_CONSOLE_ADMIN_PASSWORD_HASH');
      expect(invalidVariables).toContain('ADMIN_CONSOLE_LOCAL_LLM_ADMIN_API_KEY');
    }
  });

  it('rejects short service keys and a plain-text password', async () => {
    await expect(buildTestConfig('http://upstream:1', { ADMIN_CONSOLE_RAG_ADMIN_API_KEY: 'short' })).rejects.toThrow(
      /RAG_ADMIN_API_KEY/,
    );
    await expect(
      buildTestConfig('http://upstream:1', { ADMIN_CONSOLE_ADMIN_PASSWORD_HASH: 'hunter2' }),
    ).rejects.toThrow(/ADMIN_PASSWORD_HASH/);
  });

  it('applies defaults, trims trailing slashes and treats blank optional URLs as unset', async () => {
    const config = await buildTestConfig('http://upstream:1/', { ADMIN_CONSOLE_DOCUMENT_PARSER_URL: '' });

    expect(config.server.port).toBe(8080);
    expect(config.session.cookieSecure).toBe(false);
    expect(config.services.rag.baseUrl).toBe('http://upstream:1');
    expect(config.services.documentParserUrl).toBeUndefined();
    expect(config.timeouts.upstreamMilliseconds).toBe(60_000);
  });
});
