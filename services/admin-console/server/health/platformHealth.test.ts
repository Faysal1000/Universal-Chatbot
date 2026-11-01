import { sendJson, startStubUpstream } from '../testSupport/testServers.ts';
import { probe, readDependencies } from './platformHealth.ts';

describe('readDependencies', () => {
  it('reads rag-style maps and list-style checks', () => {
    expect(readDependencies({ checks: { postgres: 'up', redis: 'down' } })).toEqual([
      { name: 'postgres', status: 'up' },
      { name: 'redis', status: 'down' },
    ]);
    expect(readDependencies({ checks: [{ name: 'redis', status: 'up' }, { bogus: true }] })).toEqual([
      { name: 'redis', status: 'up' },
    ]);
    expect(readDependencies({ status: 'ready' })).toEqual([]);
  });
});

describe('probe', () => {
  it('reports not_ready with the service detail on 503 and unreachable on connection failure', async () => {
    const upstream = await startStubUpstream((_request, response) =>
      sendJson(response, 503, { detail: 'Embedding service is not ready' }),
    );
    const target = { id: 'embedding-server', name: 'Embedding server', role: '', url: `${upstream.url}/health/ready` };

    const notReady = await probe(target, 1000);
    await upstream.close();
    const unreachable = await probe(target, 1000);

    expect(notReady).toMatchObject({ status: 'not_ready', httpStatus: 503, detail: 'Embedding service is not ready' });
    expect(unreachable).toMatchObject({ status: 'unreachable', detail: 'connection failed' });
  });
});
