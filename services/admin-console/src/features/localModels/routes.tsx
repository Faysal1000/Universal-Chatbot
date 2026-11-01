import type { RouteObject } from 'react-router';

import { ROUTE_PATHS } from '@/shared/routePaths';

export const localModelRoutes: RouteObject[] = [
  {
    path: ROUTE_PATHS.localModels,
    lazy: () => import('./LocalModelsPage').then((page) => ({ Component: page.LocalModelsPage })),
  },
];
