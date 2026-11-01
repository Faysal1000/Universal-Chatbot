import { Module } from '@nestjs/common';

import { ChunkVectorsRepository } from './chunk-vectors.repository.js';
import { ChunksRepository } from './chunks.repository.js';
import { IndexVersionsRepository } from './index-versions.repository.js';
import { LiveIndexService } from './live-index.service.js';

@Module({
  providers: [IndexVersionsRepository, ChunksRepository, ChunkVectorsRepository, LiveIndexService],
  exports: [IndexVersionsRepository, ChunksRepository, ChunkVectorsRepository, LiveIndexService],
})
export class IndexVersionsModule {}
