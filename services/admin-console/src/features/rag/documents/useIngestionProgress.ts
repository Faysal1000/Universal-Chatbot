import { useEffect, useRef, useState } from 'react';

import { ragBrowserUrls } from '../shared/ragBrowserUrls';
import {
  DELETED_EVENT_NAME,
  deletedIngestionProgress,
  describeIngestionProgress,
  parseProgressEventData,
  PROGRESS_EVENT_NAME,
  waitingIngestionProgress,
} from './ingestionProgressModel';
import type { IngestionProgressView } from './ingestionProgressModel';

export interface IngestionProgressState {
  progress: IngestionProgressView;
  /** Set when the stream cannot be opened (e.g. the document no longer exists). */
  connectionError: string | null;
}

const STREAM_UNAVAILABLE_MESSAGE = 'Live progress is unavailable. Refresh the page to see the latest status.';

/**
 * Follows a document's ingestion over rag's server-sent events until it settles.
 * rag ends the stream after a settled event; the source is closed first so the browser
 * does not reconnect. `onSettled` runs once, when the document is ready, failed or deleted.
 */
export function useIngestionProgress(documentId: string | null, onSettled: () => void): IngestionProgressState {
  const [state, setState] = useState<IngestionProgressState>({
    progress: waitingIngestionProgress(),
    connectionError: null,
  });
  const onSettledReference = useRef(onSettled);

  useEffect(() => {
    onSettledReference.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    if (documentId === null) return;
    const eventSource = new EventSource(ragBrowserUrls.documentEvents(documentId));

    const settle = (progress: IngestionProgressView) => {
      eventSource.close();
      setState({ progress, connectionError: null });
      onSettledReference.current();
    };

    eventSource.addEventListener(PROGRESS_EVENT_NAME, (messageEvent) => {
      const progressEvent = parseProgressEventData(messageEvent.data as string);
      if (progressEvent === null) return;
      const progress = describeIngestionProgress(progressEvent);
      if (progress.isSettled) settle(progress);
      else setState({ progress, connectionError: null });
    });
    eventSource.addEventListener(DELETED_EVENT_NAME, () => settle(deletedIngestionProgress()));
    eventSource.addEventListener('error', () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        setState((previous) => ({ ...previous, connectionError: STREAM_UNAVAILABLE_MESSAGE }));
      }
    });

    return () => eventSource.close();
  }, [documentId]);

  return state;
}
