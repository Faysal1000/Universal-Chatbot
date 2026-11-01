import { describeError } from '@/shared/api/httpClient';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import { useToast } from '@/shared/ui/toastContext';

import { useDeleteDocument } from '../api/documentQueries';
import type { DocumentSummary } from '../api/documentTypes';
import { documentDisplayName } from '../documentStatusModel';

export interface DeleteDocumentDialogProps {
  /** The document to delete; null keeps the dialog closed. */
  document: Pick<DocumentSummary, 'id' | 'title' | 'originalFilename'> | null;
  onClose: () => void;
  onDeleted?: () => void;
}

/** Confirms deletion; rag then removes the document from the index, storage and database in the background. */
export function DeleteDocumentDialog({ document, onClose, onDeleted }: DeleteDocumentDialogProps) {
  const deleteMutation = useDeleteDocument();
  const { showToast } = useToast();
  const displayName = document ? documentDisplayName(document) : '';

  const confirmDeletion = () => {
    if (!document) return;
    deleteMutation.mutate(document.id, {
      onSuccess: () => {
        showToast(`Deleting ${displayName}.`, 'success');
        onClose();
        onDeleted?.();
      },
    });
  };

  return (
    <ConfirmDialog
      isOpen={document !== null}
      title={`Delete “${displayName}”?`}
      message={
        <p>
          The document stops answering questions at once. Its chunks, page images and the original file are then removed
          from the index and storage. This cannot be undone; upload the file again to restore it.
        </p>
      }
      confirmLabel="Delete document"
      isConfirming={deleteMutation.isPending}
      errorMessage={deleteMutation.isError ? describeError(deleteMutation.error) : null}
      onConfirm={confirmDeletion}
      onCancel={() => {
        deleteMutation.reset();
        onClose();
      }}
    />
  );
}
