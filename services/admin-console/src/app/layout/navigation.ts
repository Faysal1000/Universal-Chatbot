import { BookOpenText, Cpu, Gauge, type LucideIcon, Workflow } from 'lucide-react';

import { ROUTE_PATHS } from '@/shared/routePaths';

interface NavigationLink {
  path: string;
  label: string;
  /** Match only the exact path (for section roots that have sub-pages). */
  end?: boolean;
}

export interface NavigationGroup {
  label: string;
  icon: LucideIcon;
  links: readonly NavigationLink[];
}

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    label: 'Platform',
    icon: Gauge,
    links: [{ path: ROUTE_PATHS.overview, label: 'Overview', end: true }],
  },
  {
    label: 'LLM gateway',
    icon: Workflow,
    links: [
      { path: ROUTE_PATHS.gatewayAnalytics, label: 'Analytics' },
      { path: ROUTE_PATHS.routing, label: 'Routing and chains' },
      { path: ROUTE_PATHS.providers, label: 'Providers and models' },
      { path: ROUTE_PATHS.gatewayRequests, label: 'Requests' },
    ],
  },
  {
    label: 'Models',
    icon: Cpu,
    links: [{ path: ROUTE_PATHS.localModels, label: 'Local models' }],
  },
  {
    label: 'RAG',
    icon: BookOpenText,
    links: [
      { path: ROUTE_PATHS.ragOverview, label: 'Overview', end: true },
      { path: ROUTE_PATHS.ragDocuments, label: 'Documents' },
      { path: ROUTE_PATHS.ragSettings, label: 'Chatbot settings' },
      { path: ROUTE_PATHS.ragConversations, label: 'Conversations' },
      { path: ROUTE_PATHS.ragFeedback, label: 'Feedback' },
      { path: ROUTE_PATHS.ragWebsiteWidgets, label: 'Website widgets' },
      { path: ROUTE_PATHS.ragClientBlocks, label: 'Client blocks' },
      { path: ROUTE_PATHS.ragQueues, label: 'Queues' },
      { path: ROUTE_PATHS.ragIndexVersions, label: 'Index versions' },
      { path: ROUTE_PATHS.ragAudit, label: 'Audit log' },
    ],
  },
];
