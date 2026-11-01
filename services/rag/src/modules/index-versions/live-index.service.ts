import { Inject, Injectable, Logger } from '@nestjs/common';

import { ADVISORY_LOCK_KEYS, AdvisoryLocks } from '../../database/advisory-locks.js';
import { CHUNKER_VERSION } from '../../domain/chunking/structure-aware-chunker.js';
import { LEXICAL_TOKENIZER_VERSION } from '../../domain/lexical/lexical-tokenizer.js';
import {
  EMBEDDING_PORT,
  type EmbeddingModelIdentity,
  type EmbeddingPort,
} from '../../ports/embedding.port.js';
import { PermanentJobError } from '../../queue/permanent-job-error.js';
import { IndexVersionsRepository, type IndexVersionRecord } from './index-versions.repository.js';

const PROBE_TEXT = 'index dimension probe';

/**
 * The index version new documents are written to and questions are answered from. The
 * first one is created on demand from whatever model the embedding server reports.
 */
@Injectable()
export class LiveIndexService {
  private readonly logger = new Logger(LiveIndexService.name);
  private creation: Promise<IndexVersionRecord> | undefined;

  constructor(
    private readonly indexVersionsRepository: IndexVersionsRepository,
    private readonly advisoryLocks: AdvisoryLocks,
    @Inject(EMBEDDING_PORT) private readonly embeddingPort: EmbeddingPort,
  ) {}

  /** The live version, or undefined when nothing has been indexed yet. */
  findLiveVersion(): Promise<IndexVersionRecord | undefined> {
    return this.indexVersionsRepository.findLive();
  }

  async getOrCreateLiveVersion(): Promise<IndexVersionRecord> {
    const liveVersion = await this.indexVersionsRepository.findLive();
    if (liveVersion !== undefined) return liveVersion;
    this.creation ??= this.advisoryLocks
      .runExclusively(ADVISORY_LOCK_KEYS.indexVersionCreation, async () => {
        // Another process may have created it while this one waited for the lock.
        return (await this.indexVersionsRepository.findLive()) ?? (await this.createFirstVersion());
      })
      .finally(() => {
        this.creation = undefined;
      });
    return this.creation;
  }

  /** Vectors from a different model would be meaningless in this version. */
  assertCompatible(indexVersion: IndexVersionRecord, modelIdentity: EmbeddingModelIdentity): void {
    if (!usesEmbeddingModel(indexVersion, modelIdentity)) {
      throw new PermanentJobError(
        'embedding_model_changed',
        `The embedding server now serves ${modelIdentity.model}@${modelIdentity.modelRevision ?? 'unknown'} ` +
          `(${modelIdentity.dimension}-d) but index version ${indexVersion.id} uses ${indexVersion.embeddingModel}. ` +
          'Build and promote a new index version.',
      );
    }
  }

  /** The model the embedding server serves right now. */
  async currentEmbeddingModel(): Promise<EmbeddingModelIdentity> {
    const { modelIdentity } = await this.embeddingPort.embedQueries([{ kind: 'text', text: PROBE_TEXT }]);
    return modelIdentity;
  }

  /** A new, empty version for the current model and chunker. */
  async createBuildingVersion(): Promise<IndexVersionRecord> {
    const modelIdentity = await this.currentEmbeddingModel();
    return this.indexVersionsRepository.insert({
      embeddingModel: modelIdentity.model,
      embeddingModelRevision: modelIdentity.modelRevision,
      embeddingDimension: modelIdentity.dimension,
      chunkerVersion: CHUNKER_VERSION,
      lexicalTokenizerVersion: LEXICAL_TOKENIZER_VERSION,
      status: 'building',
    });
  }

  private async createFirstVersion(): Promise<IndexVersionRecord> {
    const createdVersion = await this.createBuildingVersion();
    await this.indexVersionsRepository.promote(createdVersion.id);
    this.logger.log(`Created live index version ${createdVersion.id} (${createdVersion.embeddingModel})`);
    return { ...createdVersion, status: 'live' };
  }
}

export function usesEmbeddingModel(
  indexVersion: IndexVersionRecord,
  modelIdentity: EmbeddingModelIdentity,
): boolean {
  return (
    indexVersion.embeddingModel === modelIdentity.model &&
    indexVersion.embeddingModelRevision === modelIdentity.modelRevision &&
    indexVersion.embeddingDimension === modelIdentity.dimension
  );
}
