import type { RouteObject } from 'react-router';

import { ROUTE_PATHS } from '@/shared/routePaths';

export const gatewayRoutes: RouteObject[] = [
  {
    path: ROUTE_PATHS.gatewayAnalytics,
    lazy: () => import('./analytics/dashboard/AnalyticsPage').then((page) => ({ Component: page.AnalyticsPage })),
  },
  {
    path: ROUTE_PATHS.providers,
    lazy: () => import('./providers/ProvidersPage').then((page) => ({ Component: page.ProvidersPage })),
  },
  {
    path: ROUTE_PATHS.newProvider,
    lazy: () => import('./providers/ProviderEditorPage').then((page) => ({ Component: page.ProviderEditorPage })),
  },
  {
    path: `${ROUTE_PATHS.providers}/:providerId`,
    lazy: () => import('./providers/ProviderEditorPage').then((page) => ({ Component: page.ProviderEditorPage })),
  },
  {
    path: ROUTE_PATHS.routing,
    lazy: () => import('./routing/RoutingPage').then((page) => ({ Component: page.RoutingPage })),
  },
  {
    path: ROUTE_PATHS.gatewayRequests,
    lazy: () => import('./analytics/requests/RequestsPage').then((page) => ({ Component: page.RequestsPage })),
  },
];
