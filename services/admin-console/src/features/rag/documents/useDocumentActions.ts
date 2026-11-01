import { useState } from 'react';

import { describeError } from '@/shared/api/httpClient';
import { useToast } from '@/shared/ui/toastContext';

import { useReprocessDocument, useSetDocumentEnabled } from './api/documentQueries';
import type { DocumentSummary } from './api/documentTypes';
import { documentDisplayName } from './documentStatusModel';

/**
 * Enable/disable and reprocess, with toasts for the outcome and the ids whose request is
 * still in flight (so their controls can be disabled). Deletion has its own dialog.
 * `mutateAsync` settles every call; `mutate` callbacks would run only for the latest row.
 */
export function useDocumentActions() {
  const setEnabledMutation = useSetDocumentEnabled();
  const reprocessMutation = useReprocessDocument();
  const { showToast } = useToast();
  const [busyDocumentIds, setBusyDocumentIds] = useState<ReadonlySet<string>>(new Set());

  const trackBusy = (documentId: string, isBusy: boolean) => {
    setBusyDocumentIds((current) => {
      const next = new Set(current);
      if (isBusy) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  };

  const setEnabled = (document: DocumentSummary, isEnabled: boolean) => {
    trackBusy(document.id, true);
    setEnabledMutation
      .mutateAsync({ documentId: document.id, isEnabled })
      .then(
        () => {
          const outcome = isEnabled ? 'is used in answers again' : 'is no longer used in answers';
          showToast(`${documentDisplayName(document)} ${outcome}.`, 'success');
        },
        (error: unknown) => showToast(describeError(error), 'error'),
      )
      .finally(() => trackBusy(document.id, false));
  };

  const reprocess = (document: DocumentSummary) => {
    trackBusy(document.id, true);
    reprocessMutation
      .mutateAsync(document.id)
      .then(
        () =>
          showToast(
            `Reprocessing ${documentDisplayName(document)}. Its current chunks keep answering until the new run finishes.`,
            'success',
          ),
        (error: unknown) => showToast(describeError(error), 'error'),
      )
      .finally(() => trackBusy(document.id, false));
  };

  return { busyDocumentIds, setEnabled, reprocess };
}
