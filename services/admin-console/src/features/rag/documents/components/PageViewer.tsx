import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { joinClassNames } from '@/shared/lib/classNames';
import { formatPercentFromFraction } from '@/shared/lib/format';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { ragBrowserUrls } from '../../shared/ragBrowserUrls';
import { useDocumentPage, useDocumentPages } from '../api/documentQueries';
import type { DocumentPage, DocumentPageDetail, PageBlock } from '../api/documentTypes';
import { blockTypeLabel } from '../blockTypeLabels';
import { pageIndexAfterKey } from '../pageNavigation';

/** Page list on the left; the selected page's image beside its parsed blocks. */
export function PageViewer({ documentId, documentName }: { documentId: string; documentName: string }) {
  const pagesQuery = useDocumentPages(documentId);
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null);

  if (pagesQuery.isPending) return <LoadingState label="Loading pages…" />;
  if (pagesQuery.isError) {
    return (
      <div className="p-4">
        <ErrorBanner message={describeError(pagesQuery.error)} onRetry={() => void pagesQuery.refetch()} />
      </div>
    );
  }
  if (pagesQuery.data.length === 0) {
    return <EmptyState title="No parsed pages" description="Not parsed yet. Reprocess if ingestion failed." />;
  }
  const pageNumber = selectedPageNumber ?? pagesQuery.data[0]?.pageNumber ?? null;
  return (
    <div className="grid min-h-96 grid-cols-[9rem_1fr]">
      <PageList pages={pagesQuery.data} selectedPageNumber={pageNumber} onSelect={setSelectedPageNumber} />
      {pageNumber === null ? null : (
        <PagePanel documentId={documentId} documentName={documentName} pageNumber={pageNumber} />
      )}
    </div>
  );
}

interface PageListProps {
  pages: readonly DocumentPage[];
  selectedPageNumber: number | null;
  onSelect: (pageNumber: number) => void;
}

function PageList({ pages, selectedPageNumber, onSelect }: PageListProps) {
  const buttonReferences = useRef(new Map<number, HTMLButtonElement>());

  const moveWithKeyboard = (keyboardEvent: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const nextIndex = pageIndexAfterKey(keyboardEvent.key, currentIndex, pages.length);
    const nextPage = nextIndex === null ? undefined : pages[nextIndex];
    if (nextPage === undefined) return;
    keyboardEvent.preventDefault();
    onSelect(nextPage.pageNumber);
    buttonReferences.current.get(nextPage.pageNumber)?.focus();
  };

  return (
    <nav aria-label="Pages" className="max-h-[48rem] overflow-y-auto border-r border-border">
      <p className="sr-only">Arrow keys move between pages.</p>
      <ol>
        {pages.map((page, pageIndex) => {
          const isSelected = page.pageNumber === selectedPageNumber;
          return (
            <li key={page.pageNumber}>
              <button
                type="button"
                ref={(element) => {
                  if (element) buttonReferences.current.set(page.pageNumber, element);
                  else buttonReferences.current.delete(page.pageNumber);
                }}
                aria-current={isSelected ? 'page' : undefined}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelect(page.pageNumber)}
                onKeyDown={(keyboardEvent) => moveWithKeyboard(keyboardEvent, pageIndex)}
                className={joinClassNames(
                  'flex w-full items-baseline justify-between gap-2 border-b border-border px-3 py-1.5 text-left text-sm',
                  isSelected ? 'bg-surface-selected font-medium text-primary' : 'text-secondary hover:bg-surface-hover',
                )}
              >
                <span className="tabular">Page {page.pageNumber}</span>
                <span className="text-xs text-muted">{page.pageKind}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function PagePanel({
  documentId,
  documentName,
  pageNumber,
}: {
  documentId: string;
  documentName: string;
  pageNumber: number;
}) {
  const pageQuery = useDocumentPage(documentId, pageNumber);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);

  if (pageQuery.isPending) return <LoadingState label={`Loading page ${pageNumber}…`} />;
  if (pageQuery.isError) {
    return (
      <div className="p-4">
        <ErrorBanner message={describeError(pageQuery.error)} onRetry={() => void pageQuery.refetch()} />
      </div>
    );
  }
  const page = pageQuery.data;
  const highlightedBlock = page.blocks.find((block) => block.id === highlightedBlockId);
  return (
    <div className="flex min-w-0 flex-col">
      <PageFacts page={page} />
      <div className="grid min-w-0 gap-4 p-4 xl:grid-cols-2">
        <PageImage
          documentId={documentId}
          page={page}
          altText={`Page ${pageNumber} of ${documentName}`}
          highlightedBlock={highlightedBlock}
        />
        <BlockList documentId={documentId} blocks={page.blocks} onHighlight={setHighlightedBlockId} />
      </div>
    </div>
  );
}

function PageFacts({ page }: { page: DocumentPageDetail }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted">
      <span>
        Kind <span className="text-primary">{page.pageKind}</span>
      </span>
      <span>
        Parse method <span className="font-mono text-primary">{page.parseMethod}</span>
      </span>
      <span>
        Text coverage <span className="tabular text-primary">{formatPercentFromFraction(page.textCoverageRatio)}</span>
      </span>
      <span>
        OCR quality <span className="tabular text-primary">{formatPercentFromFraction(page.ocrQualityScore)}</span>
      </span>
      <span>
        Blocks <span className="tabular text-primary">{page.blocks.length}</span>
      </span>
    </div>
  );
}

function PageImage({
  documentId,
  page,
  altText,
  highlightedBlock,
}: {
  documentId: string;
  page: DocumentPageDetail;
  altText: string;
  highlightedBlock: PageBlock | undefined;
}) {
  if (!page.hasImage) {
    return <EmptyState title="No page image" />;
  }
  return (
    <div className="relative self-start rounded border border-border bg-surface-raised">
      <img
        src={ragBrowserUrls.pageImage(documentId, page.pageNumber)}
        alt={altText}
        className="block h-auto w-full"
        loading="lazy"
      />
      {highlightedBlock ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute border-2 border-accent bg-accent-soft/40"
          style={{
            left: `${highlightedBlock.bbox.x0 * 100}%`,
            top: `${highlightedBlock.bbox.y0 * 100}%`,
            width: `${(highlightedBlock.bbox.x1 - highlightedBlock.bbox.x0) * 100}%`,
            height: `${(highlightedBlock.bbox.y1 - highlightedBlock.bbox.y0) * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

function BlockList({
  documentId,
  blocks,
  onHighlight,
}: {
  documentId: string;
  blocks: readonly PageBlock[];
  onHighlight: (blockId: string | null) => void;
}) {
  if (blocks.length === 0) {
    return <EmptyState title="No blocks on this page" />;
  }
  const blocksInReadingOrder = [...blocks].sort((first, second) => first.readingOrder - second.readingOrder);
  return (
    <ol className="flex min-w-0 flex-col" aria-label="Blocks in reading order">
      {blocksInReadingOrder.map((block) => (
        <BlockItem key={block.id} documentId={documentId} block={block} onHighlight={onHighlight} />
      ))}
    </ol>
  );
}

function BlockItem({
  documentId,
  block,
  onHighlight,
}: {
  documentId: string;
  block: PageBlock;
  onHighlight: (blockId: string | null) => void;
}) {
  const blockContent = block.markdown ?? block.text ?? block.latex;
  return (
    // Hovering only outlines the block on the page image; the same facts are in the list itself.
    <li
      className="flex flex-col gap-1.5 border-b border-border py-2.5 last:border-b-0 hover:bg-surface-hover"
      onMouseEnter={() => onHighlight(block.id)}
      onMouseLeave={() => onHighlight(null)}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="tabular text-muted">#{block.readingOrder}</span>
        <span className="font-medium text-primary">{blockTypeLabel(block.blockType)}</span>
        <span className="text-muted">{block.extractionMethod}</span>
        {block.confidence === null ? null : (
          <span className="tabular text-muted">confidence {formatPercentFromFraction(block.confidence)}</span>
        )}
        {block.sectionPath.length > 0 ? (
          <span className="truncate text-muted">{block.sectionPath.join(' › ')}</span>
        ) : null}
      </div>
      {blockContent ? (
        <p className="line-clamp-6 text-sm whitespace-pre-wrap text-secondary">{blockContent}</p>
      ) : (
        <p className="text-xs text-muted">No text extracted.</p>
      )}
      {block.hasCrop ? (
        <img
          src={ragBrowserUrls.blockCrop(documentId, block.id)}
          alt={`Crop of the ${block.blockType} block`}
          className="max-h-60 self-start rounded border border-border"
          loading="lazy"
        />
      ) : null}
    </li>
  );
}
