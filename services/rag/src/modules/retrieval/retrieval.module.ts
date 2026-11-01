import { Module } from '@nestjs/common';

import { IndexVersionsModule } from '../index-versions/index-versions.module.js';
import { RetrievalService } from './retrieval.service.js';

@Module({ imports: [IndexVersionsModule], providers: [RetrievalService], exports: [RetrievalService] })
export class RetrievalModule {}
