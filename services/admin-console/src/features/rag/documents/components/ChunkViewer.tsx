import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { formatInteger } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner, Tag } from '@/shared/ui/StatusMessages';

import { useDocumentChunks } from '../api/documentQueries';
import type { ChunkListResponse, DocumentChunk } from '../api/documentTypes';
import { CHUNK_PAGE_SIZE } from '../api/documentTypes';
import { blockTypeLabel } from '../blockTypeLabels';

/** The document's chunks in the live index version, a page of chunks at a time. */
export function ChunkViewer({ documentId }: { documentId: string }) {
  const [offset, setOffset] = useState(0);
  const chunksQuery = useDocumentChunks(documentId, offset);

  if (chunksQuery.isPending) return <LoadingState label="Loading chunks…" />;
  if (chunksQuery.isError) {
    return (
      <div className="p-4">
        <ErrorBanner message={describeError(chunksQuery.error)} onRetry={() => void chunksQuery.refetch()} />
      </div>
    );
  }
  const chunkList = chunksQuery.data;
  if (chunkList.total === 0) {
    return <EmptyState title="No chunks in the live index" description="Available after indexing." />;
  }
  return (
    <div className="flex flex-col">
      <ChunkPager
        chunkList={chunkList}
        offset={offset}
        isFetching={chunksQuery.isFetching}
        onOffsetChange={setOffset}
      />
      <ol className="flex flex-col divide-y divide-border" aria-label="Chunks">
        {chunkList.items.map((chunk, chunkIndex) => (
          <ChunkItem key={chunk.id} chunk={chunk} position={offset + chunkIndex + 1} />
        ))}
      </ol>
    </div>
  );
}

interface ChunkPagerProps {
  chunkList: ChunkListResponse;
  offset: number;
  isFetching: boolean;
  onOffsetChange: (offset: number) => void;
}

function ChunkPager({ chunkList, offset, isFetching, onOffsetChange }: ChunkPagerProps) {
  const lastShown = Math.min(offset + chunkList.items.length, chunkList.total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
      <p className="tabular text-sm text-muted" aria-live="polite">
        Chunks {formatInteger(offset + 1)}–{formatInteger(lastShown)} of {formatInteger(chunkList.total)}
        {chunkList.indexVersionId === null ? null : <> · index version {chunkList.indexVersionId}</>}
      </p>
      <div className="flex gap-2">
        <Button
          size="small"
          disabled={offset === 0 || isFetching}
          onClick={() => onOffsetChange(Math.max(0, offset - CHUNK_PAGE_SIZE))}
        >
          Previous chunks
        </Button>
        <Button
          size="small"
          disabled={lastShown >= chunkList.total || isFetching}
          onClick={() => onOffsetChange(offset + CHUNK_PAGE_SIZE)}
        >
          Next chunks
        </Button>
      </div>
    </div>
  );
}

function ChunkItem({ chunk, position }: { chunk: DocumentChunk; position: number }) {
  const pageReference =
    chunk.pageStart === chunk.pageEnd ? `Page ${chunk.pageStart}` : `Pages ${chunk.pageStart}–${chunk.pageEnd}`;
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="tabular font-medium text-primary">#{position}</span>
        <span className="tabular">{pageReference}</span>
        <span className="tabular">{formatInteger(chunk.tokenCount)} tokens</span>
        <span className="tabular">
          {chunk.blockIds.length} {chunk.blockIds.length === 1 ? 'block' : 'blocks'}
        </span>
        <Tag>{chunk.chunkKind === 'visual' ? 'Visual' : 'Text'}</Tag>
        {chunk.hasCrop ? <Tag>Has image crop</Tag> : null}
      </div>
      {chunk.blockTypes.length > 0 ? (
        <p className="text-xs text-muted">
          Built from{' '}
          <span className="text-secondary">{chunk.blockTypes.map(blockTypeLabel).join(', ').toLowerCase()}</span> blocks
        </p>
      ) : null}
      {chunk.contextualHeader ? <p className="text-xs text-secondary">{chunk.contextualHeader}</p> : null}
      <p className="text-sm whitespace-pre-wrap text-primary">{chunk.text}</p>
    </li>
  );
}
