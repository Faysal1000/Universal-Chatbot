/** URL paths of the console's pages. */
export const ROUTE_PATHS = {
  login: '/login',
  overview: '/',
  gatewayAnalytics: '/gateway/analytics',
  gatewayRequests: '/gateway/requests',
  providers: '/gateway/providers',
  newProvider: '/gateway/providers/new',
  routing: '/gateway/routing',
  localModels: '/local-models',
  ragOverview: '/rag',
  ragDocuments: '/rag/documents',
  ragSettings: '/rag/settings',
  ragConversations: '/rag/conversations',
  ragFeedback: '/rag/feedback',
  ragClientBlocks: '/rag/client-blocks',
  ragQueues: '/rag/queues',
  ragIndexVersions: '/rag/index-versions',
  ragAudit: '/rag/audit',
  ragWebsiteWidgets: '/rag/website-widgets',
} as const;

export function providerEditorPath(providerId: string): string {
  return `${ROUTE_PATHS.providers}/${encodeURIComponent(providerId)}`;
}

export function documentPath(documentId: string): string {
  return `${ROUTE_PATHS.ragDocuments}/${encodeURIComponent(documentId)}`;
}

export function conversationPath(conversationId: string): string {
  return `${ROUTE_PATHS.ragConversations}/${encodeURIComponent(conversationId)}`;
}
