import { ArrowLeft, Download, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { describeError } from '@/shared/api/httpClient';
import { formatBytes, formatDateTime, formatInteger } from '@/shared/lib/format';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { Button } from '@/shared/ui/Button';
import { Card, PageHeader } from '@/shared/ui/Layout';
import { ManifestStrip } from '@/shared/ui/ManifestStrip';
import type { ManifestField } from '@/shared/ui/ManifestStrip';
import { LoadingState } from '@/shared/ui/Spinner';
import { ErrorBanner } from '@/shared/ui/StatusMessages';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';

import { ragBrowserUrls } from '../shared/ragBrowserUrls';
import { useDocument, useInvalidateDocument } from './api/documentQueries';
import type { DocumentDetail } from './api/documentTypes';
import { ChunkViewer } from './components/ChunkViewer';
import { DeleteDocumentDialog } from './components/DeleteDocumentDialog';
import { DocumentIngestionRunsCard } from './components/DocumentIngestionRunsCard';
import { DocumentStatus } from './components/DocumentStatus';
import { IngestionProgressLine } from './components/IngestionProgressLine';
import { PageViewer } from './components/PageViewer';
import { documentDisplayName, isDocumentIngesting, mimeTypeLabel } from './documentStatusModel';
import { useDocumentActions } from './useDocumentActions';
import { useIngestionProgress } from './useIngestionProgress';

export function DocumentDetailPage() {
  const { documentId = '' } = useParams<{ documentId: string }>();
  const documentQuery = useDocument(documentId);

  if (documentQuery.isPending) return <LoadingState label="Loading document…" />;
  if (documentQuery.isError) {
    return (
      <>
        <BackToDocumentsLink />
        <ErrorBanner message={describeError(documentQuery.error)} onRetry={() => void documentQuery.refetch()} />
      </>
    );
  }
  return <DocumentDetailView document={documentQuery.data} />;
}

function BackToDocumentsLink() {
  return (
    <Link
      to={ROUTE_PATHS.ragDocuments}
      className="mb-3 inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      All documents
    </Link>
  );
}

function DocumentDetailView({ document }: { document: DocumentDetail }) {
  const navigate = useNavigate();
  const { busyDocumentIds, setEnabled, reprocess } = useDocumentActions();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const displayName = documentDisplayName(document);
  const isBusy = busyDocumentIds.has(document.id) || document.status === 'deleting';

  return (
    <>
      <BackToDocumentsLink />
      <PageHeader
        title={displayName}
        description={document.title ? document.originalFilename : undefined}
        actions={
          <>
            <ToggleSwitch
              isOn={document.isEnabled}
              onChange={(isEnabled) => setEnabled(document, isEnabled)}
              label="Use in answers"
              disabled={isBusy}
            />
            <Button
              leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
              disabled={isBusy}
              onClick={() => reprocess(document)}
            >
              Reprocess
            </Button>
            <a
              href={ragBrowserUrls.documentDownload(document.id)}
              download={document.originalFilename}
              className="inline-flex h-9 items-center gap-2 rounded border border-border bg-surface-raised px-3.5 text-sm font-medium text-primary hover:border-border-strong hover:bg-surface-hover"
            >
              <Download aria-hidden="true" className="size-4" />
              Download original
            </a>
            <Button
              variant="danger"
              leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
              disabled={document.status === 'deleting'}
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              Delete
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {isDocumentIngesting(document.status) ? <LiveIngestionCard document={document} /> : null}
        <div className="flex flex-col gap-2">
          <ManifestStrip fields={manifestFields(document)} />
          {document.status === 'failed' ? <DocumentStatus document={document} /> : null}
        </div>
        <DocumentIngestionRunsCard document={document} />
        <Card title="Pages" bodyClassName="p-0">
          <PageViewer documentId={document.id} documentName={displayName} />
        </Card>
        <Card title="Chunks" bodyClassName="p-0">
          <ChunkViewer documentId={document.id} />
        </Card>
      </div>
      <DeleteDocumentDialog
        document={isDeleteDialogOpen ? document : null}
        onClose={() => setIsDeleteDialogOpen(false)}
        onDeleted={() => void navigate(ROUTE_PATHS.ragDocuments)}
      />
    </>
  );
}

function LiveIngestionCard({ document }: { document: DocumentDetail }) {
  const invalidateDocument = useInvalidateDocument();
  const { progress, connectionError } = useIngestionProgress(document.id, () => void invalidateDocument(document.id));
  return (
    <Card title="Ingestion in progress">
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <IngestionProgressLine progress={progress} subject={documentDisplayName(document)} />
        {connectionError ? <p className="text-xs text-muted">{connectionError}</p> : null}
      </div>
    </Card>
  );
}

function manifestFields(document: DocumentDetail): ManifestField[] {
  return [
    { label: 'Status', value: <DocumentStatus document={{ status: document.status, failure: null }} /> },
    {
      label: 'Enabled',
      value: document.isEnabled ? 'Yes' : 'No',
      note: document.isEnabled ? 'Used in answers' : 'Not used',
    },
    { label: 'Type', value: mimeTypeLabel(document.mimeType), note: document.detectedLanguage ?? undefined },
    { label: 'Pages', value: formatInteger(document.pageCount), note: describePageKinds(document.storage.pagesByKind) },
    { label: 'Size', value: formatBytes(document.byteSize) },
    {
      label: 'Chunks',
      value: formatInteger(document.storage.chunkCount),
      note:
        document.storage.indexVersionId === null ? 'Not indexed' : `Index version ${document.storage.indexVersionId}`,
    },
    { label: 'Uploaded', value: formatDateTime(document.createdAt), note: `SHA-256 ${document.sha256.slice(0, 12)}…` },
    { label: 'Updated', value: formatDateTime(document.updatedAt) },
  ];
}

function describePageKinds(pagesByKind: Record<string, number>): string | undefined {
  const parts = Object.entries(pagesByKind)
    .filter(([, pageCount]) => pageCount > 0)
    .map(([pageKind, pageCount]) => `${pageCount} ${pageKind}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}
