import { useCallback, useRef, useState } from 'react';

import { useInvalidateDocument } from './api/documentQueries';
import { uploadDocument } from './api/documentsApi';
import { describeUploadRejection, isAcceptedUploadFile, UNSUPPORTED_FILE_MESSAGE } from './uploadModel';
import type { UploadRejection } from './uploadModel';

/** uploading → ingesting (rag accepted the file) → settled; or rejected at any point before ingesting. */
type UploadPhase = 'uploading' | 'ingesting' | 'settled' | 'rejected';

export interface UploadEntry {
  key: string;
  fileName: string;
  phase: UploadPhase;
  loadedBytes: number;
  totalBytes: number;
  documentId: string | null;
  rejection: UploadRejection | null;
}

function newUploadEntry(key: string, file: File): UploadEntry {
  const isAccepted = isAcceptedUploadFile(file);
  return {
    key,
    fileName: file.name,
    phase: isAccepted ? 'uploading' : 'rejected',
    loadedBytes: 0,
    totalBytes: file.size,
    documentId: null,
    rejection: isAccepted ? null : { title: 'Unsupported file type', message: UNSUPPORTED_FILE_MESSAGE },
  };
}

/**
 * The upload queue of the documents page: sends each file with byte progress and keeps an
 * entry per file so the page can follow its ingestion once rag has accepted it.
 */
export function useDocumentUploads() {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const nextKeyReference = useRef(0);
  const invalidateDocument = useInvalidateDocument();

  const updateEntry = useCallback((key: string, changes: Partial<UploadEntry>) => {
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)));
  }, []);

  const startUpload = (key: string, file: File) => {
    uploadDocument(file, ({ loadedBytes, totalBytes }) => updateEntry(key, { loadedBytes, totalBytes })).then(
      (document) => {
        updateEntry(key, { phase: 'ingesting', documentId: document.id });
        void invalidateDocument();
      },
      (error: unknown) => updateEntry(key, { phase: 'rejected', rejection: describeUploadRejection(error) }),
    );
  };

  const addFiles = (files: readonly File[]) => {
    const queuedUploads = files.map((file) => {
      nextKeyReference.current += 1;
      return { file, entry: newUploadEntry(`upload-${nextKeyReference.current}`, file) };
    });
    setEntries((current) => [...queuedUploads.map(({ entry }) => entry), ...current]);
    for (const { file, entry } of queuedUploads) {
      if (entry.phase === 'uploading') startUpload(entry.key, file);
    }
  };

  /** Called when rag reports the document ready, failed or deleted: the list shows the outcome too. */
  const markSettled = (key: string, documentId: string) => {
    updateEntry(key, { phase: 'settled' });
    void invalidateDocument(documentId);
  };

  const clearFinished = () => {
    setEntries((current) => current.filter((entry) => entry.phase === 'uploading' || entry.phase === 'ingesting'));
  };

  return { entries, addFiles, markSettled, clearFinished };
}
