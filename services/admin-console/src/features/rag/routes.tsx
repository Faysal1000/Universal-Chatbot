import type { RouteObject } from 'react-router';

import { ROUTE_PATHS } from '@/shared/routePaths';

export const ragRoutes: RouteObject[] = [
  {
    path: ROUTE_PATHS.ragOverview,
    lazy: () => import('./overview/RagOverviewPage').then((page) => ({ Component: page.RagOverviewPage })),
  },
  {
    path: ROUTE_PATHS.ragDocuments,
    lazy: () => import('./documents/DocumentsPage').then((page) => ({ Component: page.DocumentsPage })),
  },
  {
    path: `${ROUTE_PATHS.ragDocuments}/:documentId`,
    lazy: () => import('./documents/DocumentDetailPage').then((page) => ({ Component: page.DocumentDetailPage })),
  },
  {
    path: ROUTE_PATHS.ragSettings,
    lazy: () => import('./settings/ChatbotSettingsPage').then((page) => ({ Component: page.ChatbotSettingsPage })),
  },
  {
    path: ROUTE_PATHS.ragConversations,
    lazy: () => import('./conversations/ConversationsPage').then((page) => ({ Component: page.ConversationsPage })),
  },
  {
    path: `${ROUTE_PATHS.ragConversations}/:conversationId`,
    lazy: () =>
      import('./conversations/ConversationDetailPage').then((page) => ({ Component: page.ConversationDetailPage })),
  },
  {
    path: ROUTE_PATHS.ragFeedback,
    lazy: () => import('./feedback/FeedbackPage').then((page) => ({ Component: page.FeedbackPage })),
  },
  {
    path: ROUTE_PATHS.ragWebsiteWidgets,
    lazy: () => import('./websiteWidgets/WebsiteWidgetsPage').then((page) => ({ Component: page.WebsiteWidgetsPage })),
  },
  {
    path: ROUTE_PATHS.ragClientBlocks,
    lazy: () => import('./clientBlocks/ClientBlocksPage').then((page) => ({ Component: page.ClientBlocksPage })),
  },
  {
    path: ROUTE_PATHS.ragQueues,
    lazy: () => import('./operations/QueuesPage').then((page) => ({ Component: page.QueuesPage })),
  },
  {
    path: ROUTE_PATHS.ragIndexVersions,
    lazy: () => import('./indexVersions/IndexVersionsPage').then((page) => ({ Component: page.IndexVersionsPage })),
  },
  {
    path: ROUTE_PATHS.ragAudit,
    lazy: () => import('./audit/AuditLogPage').then((page) => ({ Component: page.AuditLogPage })),
  },
];
