import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider, createBrowserRouter, type RouteObject } from 'react-router';

import { gatewayRoutes } from '@/features/gateway/routes';
import { localModelRoutes } from '@/features/localModels/routes';
import { ragRoutes } from '@/features/rag/routes';
import { LoginPage } from '@/features/session/LoginPage';
import { BASE_PATH } from '@/shared/basePath';
import { ROUTE_PATHS } from '@/shared/routePaths';
import { LoadingState } from '@/shared/ui/Spinner';
import { ToastProvider } from '@/shared/ui/ToastProvider';

import { NotFoundPage } from './NotFoundPage';
import { ConsoleLayout } from './layout/ConsoleLayout';
import { RequireSession } from './layout/RequireSession';
import { createAdminQueryClient } from './queryClient';

// Every page loads on demand in its own chunk; the router keeps the current page until the next one is ready.
const consoleRoutes: RouteObject[] = [
  {
    path: ROUTE_PATHS.overview,
    lazy: () => import('@/features/overview/OverviewPage').then((page) => ({ Component: page.default })),
  },
  ...gatewayRoutes,
  ...localModelRoutes,
  ...ragRoutes,
  { path: '*', element: <NotFoundPage /> },
];

const router = createBrowserRouter(
  [
    { path: ROUTE_PATHS.login, element: <LoginPage /> },
    {
      element: (
        <RequireSession>
          <ConsoleLayout />
        </RequireSession>
      ),
      hydrateFallbackElement: <LoadingState label="Loading page…" />,
      children: consoleRoutes,
    },
  ],
  { basename: BASE_PATH || '/' },
);

export function App() {
  const [queryClient] = useState(createAdminQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
