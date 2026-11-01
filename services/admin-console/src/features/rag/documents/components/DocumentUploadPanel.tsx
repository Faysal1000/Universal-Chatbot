import { Upload } from 'lucide-react';
import { useState } from 'react';
import type { DragEvent } from 'react';
import { Link } from 'react-router';

import { joinClassNames } from '@/shared/lib/classNames';
import { formatBytes } from '@/shared/lib/format';
import { documentPath } from '@/shared/routePaths';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Layout';
import { StatePlacard } from '@/shared/ui/StatePlacard';

import { UPLOAD_ACCEPT_ATTRIBUTE, uploadPercent } from '../uploadModel';
import type { UploadEntry } from '../useDocumentUploads';
import { useIngestionProgress } from '../useIngestionProgress';
import { IngestionProgressLine } from './IngestionProgressLine';
import { ProgressBar } from './ProgressBar';

export interface DocumentUploadPanelProps {
  entries: readonly UploadEntry[];
  onFilesChosen: (files: File[]) => void;
  onIngestionSettled: (key: string, documentId: string) => void;
  onClearFinished: () => void;
}

/** Drop zone and file picker, then each file's upload and ingestion progress. */
export function DocumentUploadPanel({
  entries,
  onFilesChosen,
  onIngestionSettled,
  onClearFinished,
}: DocumentUploadPanelProps) {
  const hasFinishedEntries = entries.some((entry) => entry.phase === 'settled' || entry.phase === 'rejected');
  return (
    <Card
      title="Upload"
      description="PDF, PNG, JPEG or TIFF"
      actions={
        hasFinishedEntries ? (
          <Button size="small" variant="ghost" onClick={onClearFinished}>
            Clear finished
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <DropZone onFilesChosen={onFilesChosen} />
        <div role="status" aria-live="polite" aria-label="Upload progress">
          {entries.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded border border-border">
              {entries.map((entry) => (
                <UploadEntryItem key={entry.key} entry={entry} onIngestionSettled={onIngestionSettled} />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function DropZone({ onFilesChosen }: { onFilesChosen: (files: File[]) => void }) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const acceptDrop = (dragEvent: DragEvent<HTMLDivElement>) => {
    dragEvent.preventDefault();
    setIsDraggingOver(false);
    const droppedFiles = Array.from(dragEvent.dataTransfer.files);
    if (droppedFiles.length > 0) onFilesChosen(droppedFiles);
  };

  return (
    <div
      onDragOver={(dragEvent) => {
        dragEvent.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={acceptDrop}
      className={joinClassNames(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-8 text-center',
        isDraggingOver ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface-raised',
      )}
    >
      <p className="text-sm text-secondary">Drop files here, or</p>
      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-transparent bg-accent px-3.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring">
        <Upload aria-hidden="true" className="size-4" />
        Upload documents
        <input
          type="file"
          multiple
          accept={UPLOAD_ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={(changeEvent) => {
            const chosenFiles = Array.from(changeEvent.target.files ?? []);
            changeEvent.target.value = '';
            if (chosenFiles.length > 0) onFilesChosen(chosenFiles);
          }}
        />
      </label>
    </div>
  );
}

function UploadEntryItem({
  entry,
  onIngestionSettled,
}: {
  entry: UploadEntry;
  onIngestionSettled: (key: string, documentId: string) => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        {entry.documentId ? (
          <Link
            to={documentPath(entry.documentId)}
            className="truncate text-sm font-medium text-accent hover:underline"
          >
            {entry.fileName}
          </Link>
        ) : (
          <span className="truncate text-sm font-medium text-primary">{entry.fileName}</span>
        )}
        <span className="tabular text-xs text-muted">{formatBytes(entry.totalBytes)}</span>
      </div>
      <UploadEntryProgress entry={entry} onIngestionSettled={onIngestionSettled} />
    </li>
  );
}

function UploadEntryProgress({
  entry,
  onIngestionSettled,
}: {
  entry: UploadEntry;
  onIngestionSettled: (key: string, documentId: string) => void;
}) {
  if (entry.rejection) {
    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <StatePlacard state="failed" label={entry.rejection.title} />
        <p className="text-secondary">{entry.rejection.message}</p>
        {entry.rejection.existingDocumentPath ? (
          <Link to={entry.rejection.existingDocumentPath} className="font-medium text-accent hover:underline">
            Open the existing document
          </Link>
        ) : null}
      </div>
    );
  }
  if (entry.documentId === null) {
    const percent = uploadPercent(entry.loadedBytes, entry.totalBytes);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <StatePlacard state="working" label="Uploading" />
          <span className="tabular text-muted">
            {formatBytes(entry.loadedBytes)} of {formatBytes(entry.totalBytes)} · {percent}%
          </span>
        </div>
        <ProgressBar percent={percent} label={`Upload of ${entry.fileName}`} />
      </div>
    );
  }
  const documentId = entry.documentId;
  return (
    <FollowedIngestion
      documentId={documentId}
      subject={entry.fileName}
      onSettled={() => onIngestionSettled(entry.key, documentId)}
    />
  );
}

function FollowedIngestion({
  documentId,
  subject,
  onSettled,
}: {
  documentId: string;
  subject: string;
  onSettled: () => void;
}) {
  const { progress, connectionError } = useIngestionProgress(documentId, onSettled);
  return (
    <>
      <IngestionProgressLine progress={progress} subject={subject} />
      {connectionError ? <p className="text-xs text-muted">{connectionError}</p> : null}
    </>
  );
}
