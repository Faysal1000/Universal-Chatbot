import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchCurrentSession, signIn, signOut } from './sessionApi';
import { sessionQueryKeys } from './sessionQueryKeys';
import type { LoginRequest } from './sessionTypes';

export function useCurrentSession() {
  return useQuery({
    queryKey: sessionQueryKeys.current,
    queryFn: fetchCurrentSession,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: LoginRequest) => signIn(credentials),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionQueryKeys.current, session);
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSettled: () => {
      // Keep the session query itself: `RequireSession` observes it and redirects on `null`.
      queryClient.setQueryData(sessionQueryKeys.current, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionQueryKeys.current[0] });
    },
  });
}
