import { Link } from 'react-router';

import { joinClassNames } from '@/shared/lib/classNames';
import { formatDurationMilliseconds, formatInteger } from '@/shared/lib/format';
import { documentPath } from '@/shared/routePaths';
import { StatePlacard } from '@/shared/ui/StatePlacard';
import { DataCell, HeaderCell, Table } from '@/shared/ui/Table';

import { formatKeywordScore, formatFusedScore, formatRank, formatSimilarity } from '../retrievalScoreFormat';
import {
  buildChunkScoreRows,
  buildQuerySearchRows,
  describePageRange,
  describeSimilarityDecision,
  parseRetrievalTrace,
  shortUuid,
} from '../retrievalTraceModel';
import type { RetrievalTrace } from '../retrievalTraceModel';

/** What retrieval did for one turn: the queries, every chunk's scores and the min_similarity gate. */
export function RetrievalTracePanel({ rawTrace }: { rawTrace: Record<string, unknown> | null }) {
  const trace = parseRetrievalTrace(rawTrace);
  if (trace === null) {
    return <p className="text-sm text-muted">No retrieval trace: retrieval was skipped or the trace has expired.</p>;
  }
  return (
    <details className="group rounded border border-border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
        <span className="font-medium text-primary">Retrieval trace</span>
        <StatePlacard
          state={trace.outcome === 'answerable' ? 'ready' : 'warning'}
          label={trace.outcome === 'answerable' ? 'Evidence found' : 'No evidence'}
        />
        <span className="tabular text-muted">
          best {formatSimilarity(trace.bestDenseSimilarity)} / minimum {formatSimilarity(trace.minSimilarity)}
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border p-3">
        <TraceDecision trace={trace} />
        <SelectedSourcesTable trace={trace} />
        <QuerySearchTable trace={trace} />
        <ChunkScoreTable trace={trace} />
      </div>
    </details>
  );
}

function TraceDecision({ trace }: { trace: RetrievalTrace }) {
  const { embedding, search, total } = trace.timingsMilliseconds;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-primary">{describeSimilarityDecision(trace)}</p>
      <p className="tabular text-xs text-muted">
        Index version {trace.indexVersionId ?? '—'} · embedding {formatDurationMilliseconds(embedding)} · search{' '}
        {formatDurationMilliseconds(search)} · retrieval total {formatDurationMilliseconds(total)}
      </p>
    </div>
  );
}

function SelectedSourcesTable({ trace }: { trace: RetrievalTrace }) {
  if (trace.selected.length === 0) return null;
  return (
    <section aria-label="Sources sent to the model">
      <h3 className="mb-1 text-xs font-medium text-muted">Sources sent to the model, in citation order</h3>
      <Table caption="Sources sent to the model with their documents, pages and scores">
        <thead>
          <tr>
            <HeaderCell>Source</HeaderCell>
            <HeaderCell>Document</HeaderCell>
            <HeaderCell>Pages</HeaderCell>
            <HeaderCell>Kind</HeaderCell>
            <HeaderCell isNumeric>RRF score</HeaderCell>
            <HeaderCell isNumeric>Dense similarity</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {trace.selected.map((source, sourceIndex) => (
            <tr key={source.chunkId}>
              <DataCell className="font-medium text-primary">[{sourceIndex + 1}]</DataCell>
              <DataCell className="max-w-72 truncate">
                <Link to={documentPath(source.documentId)} className="text-accent hover:underline">
                  {source.documentTitle}
                </Link>
              </DataCell>
              <DataCell className="tabular whitespace-nowrap">{describePageRange(source)}</DataCell>
              <DataCell className="capitalize">{source.chunkKind}</DataCell>
              <DataCell isNumeric>{formatFusedScore(source.fusedScore)}</DataCell>
              <DataCell isNumeric>{formatSimilarity(source.denseSimilarity)}</DataCell>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

function QuerySearchTable({ trace }: { trace: RetrievalTrace }) {
  const rows = buildQuerySearchRows(trace);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Searched queries">
      <h3 className="mb-1 text-xs font-medium text-muted">Searched queries (dense and keyword per query)</h3>
      <Table caption="Searched queries with their dense and keyword results">
        <thead>
          <tr>
            <HeaderCell>Query</HeaderCell>
            <HeaderCell isNumeric>Dense hits</HeaderCell>
            <HeaderCell isNumeric>Top similarity</HeaderCell>
            <HeaderCell isNumeric>Keyword hits</HeaderCell>
            <HeaderCell isNumeric>Top keyword</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${String(rowIndex)}-${row.label}`}>
              <DataCell className={joinClassNames(row.isImageQuery && 'text-muted italic')}>{row.label}</DataCell>
              <DataCell isNumeric>{formatInteger(row.denseHitCount)}</DataCell>
              <DataCell isNumeric>{formatSimilarity(row.topDenseSimilarity)}</DataCell>
              <DataCell isNumeric>{row.isImageQuery ? 'Not searched' : formatInteger(row.sparseHitCount)}</DataCell>
              <DataCell isNumeric>{formatKeywordScore(row.topKeywordScore)}</DataCell>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

function ChunkScoreTable({ trace }: { trace: RetrievalTrace }) {
  const rows = buildChunkScoreRows(trace);
  if (rows.length === 0) return <p className="text-sm text-muted">No chunk was retrieved.</p>;
  return (
    <section aria-label="Retrieved chunks">
      <h3 className="mb-1 text-xs font-medium text-muted">
        Retrieved chunks by fused rank (top {rows.length}); the best dense and keyword result over all queries
      </h3>
      <Table caption="Retrieved chunks with dense, keyword and fused scores">
        <thead>
          <tr>
            <HeaderCell isNumeric>RRF rank</HeaderCell>
            <HeaderCell>Chunk</HeaderCell>
            <HeaderCell isNumeric>RRF score</HeaderCell>
            <HeaderCell isNumeric>Dense similarity</HeaderCell>
            <HeaderCell isNumeric>Dense rank</HeaderCell>
            <HeaderCell isNumeric>Keyword score</HeaderCell>
            <HeaderCell isNumeric>Keyword rank</HeaderCell>
            <HeaderCell>Sent to model</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.chunkId} className={joinClassNames(row.sourceNumber !== null && 'bg-surface-raised')}>
              <DataCell isNumeric>{formatRank(row.fusedRank)}</DataCell>
              <DataCell className="font-mono text-xs" title={row.chunkId}>
                {shortUuid(row.chunkId)}
              </DataCell>
              <DataCell isNumeric>{formatFusedScore(row.fusedScore)}</DataCell>
              <DataCell isNumeric>{formatSimilarity(row.bestDenseSimilarity)}</DataCell>
              <DataCell isNumeric>{formatRank(row.bestDenseRank)}</DataCell>
              <DataCell isNumeric>{formatKeywordScore(row.bestKeywordScore)}</DataCell>
              <DataCell isNumeric>{formatRank(row.bestSparseRank)}</DataCell>
              <DataCell>
                {row.sourceNumber === null ? (
                  <span className="text-muted">No</span>
                ) : (
                  <span className="font-medium text-primary">Source [{row.sourceNumber}]</span>
                )}
              </DataCell>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
