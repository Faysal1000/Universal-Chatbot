import type { IndexVersion } from './api/indexVersionTypes';
import {
  describeEmbeddingModel,
  findLiveVersion,
  hasBuildInProgress,
  indexVersionActions,
  indexVersionPlacard,
  isRollback,
} from './indexVersionModel';

function anIndexVersion(overrides: Partial<IndexVersion> = {}): IndexVersion {
  return {
    id: 3,
    status: 'ready',
    embeddingModel: 'embeddinggemma-300m',
    embeddingModelRevision: 'abcdef1234567',
    embeddingDimension: 768,
    chunkerVersion: 'structure-v2',
    lexicalTokenizerVersion: 'icu-word-nfkc-v1',
    missingDocumentCount: 0,
    createdAt: '2026-10-29T10:00:00Z',
    promotedAt: null,
    ...overrides,
  };
}

describe('indexVersionActions', () => {
  it('offers promotion for a complete ready version', () => {
    expect(indexVersionActions(anIndexVersion())).toEqual({
      canBuild: false,
      canPromote: true,
      promoteBlockedReason: null,
      canDelete: true,
    });
  });

  it('asks to build an incomplete version before promotion', () => {
    const actions = indexVersionActions(anIndexVersion({ status: 'retired', missingDocumentCount: 4 }));
    expect(actions.canPromote).toBe(false);
    expect(actions.canBuild).toBe(true);
    expect(actions.promoteBlockedReason).toBe('Build it first: 4 ready documents are not in it yet.');
  });

  it('never deletes the live or a building version', () => {
    expect(indexVersionActions(anIndexVersion({ status: 'live' })).canDelete).toBe(false);
    expect(indexVersionActions(anIndexVersion({ status: 'building' })).canDelete).toBe(false);
  });

  it('cannot build or promote a failed version, only delete it', () => {
    expect(indexVersionActions(anIndexVersion({ status: 'failed', missingDocumentCount: 2 }))).toMatchObject({
      canBuild: false,
      canPromote: false,
      canDelete: true,
    });
  });
});

describe('rollback and live detection', () => {
  const versions = [anIndexVersion({ id: 2, status: 'retired' }), anIndexVersion({ id: 3, status: 'live' })];

  it('finds the live version', () => {
    expect(findLiveVersion(versions)?.id).toBe(3);
  });

  it('treats promoting an older version as a rollback', () => {
    expect(isRollback({ id: 2 }, findLiveVersion(versions))).toBe(true);
    expect(isRollback({ id: 4 }, findLiveVersion(versions))).toBe(false);
    expect(isRollback({ id: 1 }, undefined)).toBe(false);
  });

  it('notices a build in progress', () => {
    expect(hasBuildInProgress(versions)).toBe(false);
    expect(hasBuildInProgress([anIndexVersion({ status: 'building' })])).toBe(true);
  });
});

describe('display', () => {
  it('labels states and the embedding model', () => {
    expect(indexVersionPlacard('live')).toEqual({ state: 'ready', label: 'Live' });
    expect(describeEmbeddingModel(anIndexVersion())).toBe('embeddinggemma-300m@abcdef12 (768 dims)');
  });
});
