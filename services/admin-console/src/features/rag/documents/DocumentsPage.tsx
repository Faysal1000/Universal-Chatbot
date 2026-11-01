import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { Button } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { LoadingState } from '@/shared/ui/Spinner';
import { EmptyState, ErrorBanner } from '@/shared/ui/StatusMessages';

import { useDebouncedValue } from '../shared/useDebouncedValue';
import { useDocumentList } from './api/documentQueries';
import type { DocumentSummary } from './api/documentTypes';
import { DeleteDocumentDialog } from './components/DeleteDocumentDialog';
import { DocumentFiltersBar } from './components/DocumentFiltersBar';
import { DocumentUploadPanel } from './components/DocumentUploadPanel';
import { DocumentsTable } from './components/DocumentsTable';
import { EMPTY_DOCUMENT_FILTERS, hasActiveFilters, toDocumentListFilters } from './documentFiltersModel';
import type { DocumentFilterValues } from './documentFiltersModel';
import { useDocumentActions } from './useDocumentActions';
import { useDocumentUploads } from './useDocumentUploads';

const FILTER_DEBOUNCE_MILLISECONDS = 300;

export function DocumentsPage() {
  const uploads = useDocumentUploads();
  return (
    <>
      <PageHeader title="Documents" />
      <div className="flex flex-col gap-6">
        <DocumentUploadPanel
          entries={uploads.entries}
          onFilesChosen={uploads.addFiles}
          onIngestionSettled={uploads.markSettled}
          onClearFinished={uploads.clearFinished}
        />
        <DocumentListCard />
      </div>
    </>
  );
}

function DocumentListCard() {
  const [filterValues, setFilterValues] = useState<DocumentFilterValues>(EMPTY_DOCUMENT_FILTERS);
  const debouncedFilterValues = useDebouncedValue(filterValues, FILTER_DEBOUNCE_MILLISECONDS);
  const documentListQuery = useDocumentList(toDocumentListFilters(debouncedFilterValues));
  const { busyDocumentIds, setEnabled, reprocess } = useDocumentActions();
  const [documentPendingDeletion, setDocumentPendingDeletion] = useState<DocumentSummary | null>(null);

  const listedDocuments = documentListQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const renderBody = () => {
    if (documentListQuery.isPending) return <LoadingState label="Loading documents…" />;
    if (documentListQuery.isError) {
      return (
        <div className="p-4">
          <ErrorBanner
            message={describeError(documentListQuery.error)}
            onRetry={() => void documentListQuery.refetch()}
          />
        </div>
      );
    }
    if (listedDocuments.length === 0) {
      return hasActiveFilters(debouncedFilterValues) ? (
        <EmptyState title="No documents match these filters" />
      ) : (
        <EmptyState title="No documents yet" description="Upload a PDF or a scanned page above." />
      );
    }
    return (
      <>
        <DocumentsTable
          documents={listedDocuments}
          busyDocumentIds={busyDocumentIds}
          onSetEnabled={setEnabled}
          onReprocess={reprocess}
          onDelete={setDocumentPendingDeletion}
        />
        {documentListQuery.hasNextPage ? (
          <div className="flex justify-center border-t border-border p-3">
            <Button
              isLoading={documentListQuery.isFetchingNextPage}
              onClick={() => void documentListQuery.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <Card title="Library" bodyClassName="p-0">
      <DocumentFiltersBar values={filterValues} onChange={setFilterValues} />
      {renderBody()}
      <DeleteDocumentDialog document={documentPendingDeletion} onClose={() => setDocumentPendingDeletion(null)} />
    </Card>
  );
}
