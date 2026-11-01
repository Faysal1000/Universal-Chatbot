import type { DocumentListQuery } from './documentTypes';

/** TanStack Query keys for rag documents; every key starts with `['rag', 'documents']`. */
export const documentQueryKeys = {
  all: ['rag', 'documents'] as const,
  lists: () => [...documentQueryKeys.all, 'list'] as const,
  list: (filters: DocumentListQuery) => [...documentQueryKeys.lists(), filters] as const,
  detail: (documentId: string) => [...documentQueryKeys.all, 'detail', documentId] as const,
  runs: (documentId: string) => [...documentQueryKeys.detail(documentId), 'runs'] as const,
  pages: (documentId: string) => [...documentQueryKeys.detail(documentId), 'pages'] as const,
  page: (documentId: string, pageNumber: number) => [...documentQueryKeys.pages(documentId), pageNumber] as const,
  chunks: (documentId: string, offset: number) => [...documentQueryKeys.detail(documentId), 'chunks', offset] as const,
};
