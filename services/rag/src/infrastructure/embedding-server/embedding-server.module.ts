import { Global, Module } from '@nestjs/common';

import { EMBEDDING_PORT } from '../../ports/embedding.port.js';
import { EmbeddingServerAdapter } from './embedding-server.adapter.js';

@Global()
@Module({
  providers: [{ provide: EMBEDDING_PORT, useClass: EmbeddingServerAdapter }],
  exports: [EMBEDDING_PORT],
})
export class EmbeddingServerModule {}
