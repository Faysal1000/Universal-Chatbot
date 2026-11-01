import {
  buildChunkScoreRows,
  buildQuerySearchRows,
  describePageRange,
  describeSimilarityDecision,
  parseRetrievalTrace,
  shortUuid,
} from './retrievalTraceModel';
import type { RetrievalTrace } from './retrievalTraceModel';

function aStoredTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    indexVersionId: 2,
    searchQueries: ['leave policy', 'annual leave days'],
    imageQueryCount: 1,
    searches: [
      {
        dense: [
          { chunkId: 'a', score: 0.71 },
          { chunkId: 'b', score: 0.64 },
        ],
        sparse: [{ chunkId: 'b', score: 0.0152 }],
      },
      {
        dense: [{ chunkId: 'b', score: 0.69 }],
        sparse: [
          { chunkId: 'c', score: 3.1 },
          { chunkId: 'a', score: 2.5 },
        ],
      },
      { dense: [{ chunkId: 'c', score: 0.4 }], sparse: [] },
    ],
    fused: [
      { chunkId: 'b', score: 0.049 },
      { chunkId: 'a', score: 0.032 },
      { chunkId: 'c', score: 0.016 },
    ],
    selectedChunkIds: ['b', 'a'],
    bestDenseSimilarity: 0.71,
    minSimilarity: 0.6,
    outcome: 'answerable',
    timingsMilliseconds: { embedding: 40, search: 12, total: 70 },
    ...overrides,
  };
}

function parsedTrace(overrides: Record<string, unknown> = {}): RetrievalTrace {
  const trace = parseRetrievalTrace(aStoredTrace(overrides));
  if (trace === null) throw new Error('The test trace should parse.');
  return trace;
}

const aSelectedSource = {
  chunkId: 'b',
  documentId: 'd1',
  documentTitle: 'Staff handbook',
  chunkKind: 'text',
  pageStart: 4,
  pageEnd: 5,
  fusedScore: 0.049,
  denseSimilarity: 0.69,
};

describe('parseRetrievalTrace', () => {
  it('reads the sources sent to the model with their documents and pages', () => {
    expect(parsedTrace({ selected: [aSelectedSource] }).selected).toEqual([aSelectedSource]);
  });

  it('reads a trace from before rag recorded sources as having none', () => {
    expect(parsedTrace().selected).toEqual([]);
  });

  it('skips a source it cannot read', () => {
    expect(parsedTrace({ selected: [{ ...aSelectedSource, chunkKind: 'table' }] }).selected).toEqual([]);
  });

  it('returns null for a turn without a trace', () => {
    expect(parseRetrievalTrace(null)).toBeNull();
  });

  it('returns null for a trace without the similarity gate', () => {
    expect(parseRetrievalTrace({ searchQueries: ['x'] })).toBeNull();
  });

  it('drops malformed hits instead of failing', () => {
    const trace = parsedTrace({ fused: [{ chunkId: 'a', score: 0.03 }, { chunkId: 7 }, 'junk'] });
    expect(trace.fused).toEqual([{ chunkId: 'a', score: 0.03 }]);
  });
});

describe('buildQuerySearchRows', () => {
  it('labels text queries by their text and image queries by number', () => {
    const rows = buildQuerySearchRows(parsedTrace());
    expect(rows.map((row) => row.label)).toEqual(['leave policy', 'annual leave days', 'Attached image 1']);
    expect(rows[2]?.isImageQuery).toBe(true);
  });

  it('reports each search’s top score and hit count', () => {
    const [firstRow] = buildQuerySearchRows(parsedTrace());
    expect(firstRow).toMatchObject({
      denseHitCount: 2,
      topDenseSimilarity: 0.71,
      sparseHitCount: 1,
      topKeywordScore: 0.0152,
    });
  });
});

describe('buildChunkScoreRows', () => {
  it('orders chunks by fused rank and keeps the best dense and sparse score across queries', () => {
    const rows = buildChunkScoreRows(parsedTrace());
    expect(rows[0]).toEqual({
      chunkId: 'b',
      fusedRank: 1,
      fusedScore: 0.049,
      bestDenseSimilarity: 0.69,
      bestDenseRank: 1,
      bestKeywordScore: 0.0152,
      bestSparseRank: 1,
      sourceNumber: 1,
    });
  });

  it('marks chunks that were not sent to the model', () => {
    const rows = buildChunkScoreRows(parsedTrace());
    expect(rows.find((row) => row.chunkId === 'c')?.sourceNumber).toBeNull();
  });

  it('adds selected chunks that fell outside the traced fused ranks', () => {
    const rows = buildChunkScoreRows(parsedTrace({ fused: [], selectedChunkIds: ['a'] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chunkId: 'a', fusedRank: null, sourceNumber: 1 });
  });
});

describe('describeSimilarityDecision', () => {
  it('explains an answered turn', () => {
    expect(describeSimilarityDecision(parsedTrace())).toBe(
      'Best dense similarity 0.710 reached the minimum 0.600; the answer was generated from 2 sources.',
    );
  });

  it('explains a fallback below the threshold', () => {
    const trace = parsedTrace({ outcome: 'no_evidence', bestDenseSimilarity: 0.52, selectedChunkIds: [] });
    expect(describeSimilarityDecision(trace)).toBe(
      'Best dense similarity 0.520 is below the minimum 0.600; the fallback message was sent.',
    );
  });

  it('explains that nothing was searched without a live index', () => {
    const trace = parsedTrace({ indexVersionId: null, outcome: 'no_evidence', bestDenseSimilarity: null });
    expect(describeSimilarityDecision(trace)).toBe('Nothing was searched: no index version was live.');
  });
});

describe('shortUuid', () => {
  it('keeps the first block of a UUID', () => {
    expect(shortUuid('3f2a9c1e-0000-4000-8000-000000000000')).toBe('3f2a9c1e');
  });
});

describe('describePageRange', () => {
  it('names one page or a range', () => {
    expect(describePageRange({ pageStart: 4, pageEnd: 4 })).toBe('p. 4');
    expect(describePageRange({ pageStart: 4, pageEnd: 6 })).toBe('pp. 4–6');
  });
});
