import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hasWorkingDocuments, isDocumentSettled } from '../documentStatusModel';
import { documentQueryKeys } from './documentQueryKeys';
import { CHUNK_PAGE_SIZE, DOCUMENT_PAGE_SIZE } from './documentTypes';
import type { DocumentListQuery } from './documentTypes';
import {
  deleteDocument,
  getDocument,
  getDocumentPage,
  listDocumentChunks,
  listDocumentIngestionRuns,
  listDocumentPages,
  listDocuments,
  reprocessDocument,
  updateDocument,
} from './documentsApi';

/** While any listed document is still changing, the list refreshes on this cadence. */
const WORKING_REFRESH_INTERVAL_MILLISECONDS = 5_000;

export type DocumentListFilters = Omit<DocumentListQuery, 'cursor' | 'limit'>;

export function useDocumentList(filters: DocumentListFilters) {
  return useInfiniteQuery({
    queryKey: documentQueryKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      listDocuments({ ...filters, cursor: pageParam, limit: DOCUMENT_PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const listedDocuments = query.state.data?.pages.flatMap((page) => page.items) ?? [];
      return hasWorkingDocuments(listedDocuments) ? WORKING_REFRESH_INTERVAL_MILLISECONDS : false;
    },
  });
}

export function useDocument(documentId: string) {
  return useQuery({
    queryKey: documentQueryKeys.detail(documentId),
    queryFn: () => getDocument(documentId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && !isDocumentSettled(status) ? WORKING_REFRESH_INTERVAL_MILLISECONDS : false;
    },
  });
}

/** Every run of the document; loaded only when asked, since the detail already lists the latest. */
export function useDocumentIngestionRuns(documentId: string, isEnabled: boolean) {
  return useQuery({
    queryKey: documentQueryKeys.runs(documentId),
    queryFn: ({ signal }) => listDocumentIngestionRuns(documentId, signal),
    enabled: isEnabled,
  });
}

export function useDocumentPages(documentId: string) {
  return useQuery({ queryKey: documentQueryKeys.pages(documentId), queryFn: () => listDocumentPages(documentId) });
}

export function useDocumentPage(documentId: string, pageNumber: number | null) {
  return useQuery({
    queryKey: documentQueryKeys.page(documentId, pageNumber ?? 0),
    queryFn: () => getDocumentPage(documentId, pageNumber ?? 0),
    enabled: pageNumber !== null,
  });
}

export function useDocumentChunks(documentId: string, offset: number) {
  return useQuery({
    queryKey: documentQueryKeys.chunks(documentId, offset),
    queryFn: () => listDocumentChunks(documentId, offset, CHUNK_PAGE_SIZE),
    placeholderData: keepPreviousData,
  });
}

/** Refreshes every list and the given document's detail (pages, chunks) after a change. */
export function useInvalidateDocument() {
  const queryClient = useQueryClient();
  return (documentId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: documentQueryKeys.lists() }),
      documentId === undefined
        ? Promise.resolve()
        : queryClient.invalidateQueries({ queryKey: documentQueryKeys.detail(documentId) }),
    ]);
}

export function useSetDocumentEnabled() {
  const invalidateDocument = useInvalidateDocument();
  return useMutation({
    mutationFn: ({ documentId, isEnabled }: { documentId: string; isEnabled: boolean }) =>
      updateDocument(documentId, { isEnabled }),
    onSuccess: (_document, { documentId }) => invalidateDocument(documentId),
  });
}

export function useReprocessDocument() {
  const invalidateDocument = useInvalidateDocument();
  return useMutation({
    mutationFn: (documentId: string) => reprocessDocument(documentId),
    onSuccess: (_reference, documentId) => invalidateDocument(documentId),
  });
}

export function useDeleteDocument() {
  const invalidateDocument = useInvalidateDocument();
  return useMutation({
    mutationFn: (documentId: string) => deleteDocument(documentId),
    onSuccess: (_reference, documentId) => invalidateDocument(documentId),
  });
}
