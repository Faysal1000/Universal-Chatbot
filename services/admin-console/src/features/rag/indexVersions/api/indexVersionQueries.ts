import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { hasBuildInProgress } from '../indexVersionModel';
import { indexVersionQueryKeys } from './indexVersionQueryKeys';
import {
  buildIndexVersion,
  createIndexVersion,
  deleteIndexVersion,
  listIndexVersions,
  promoteIndexVersion,
} from './indexVersionsApi';

const BUILD_POLL_MILLISECONDS = 5_000;
const IDLE_POLL_MILLISECONDS = 30_000;

/** Polls quickly while a version is building (or catching up), slowly otherwise. */
export function useIndexVersions() {
  return useQuery({
    queryKey: indexVersionQueryKeys.all,
    queryFn: listIndexVersions,
    refetchInterval: (query) =>
      hasBuildInProgress(query.state.data ?? []) ? BUILD_POLL_MILLISECONDS : IDLE_POLL_MILLISECONDS,
  });
}

function useInvalidateIndexVersions() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: indexVersionQueryKeys.all });
}

export function useCreateIndexVersion() {
  const invalidateIndexVersions = useInvalidateIndexVersions();
  return useMutation({ mutationFn: createIndexVersion, onSuccess: invalidateIndexVersions });
}

export function useBuildIndexVersion() {
  const invalidateIndexVersions = useInvalidateIndexVersions();
  return useMutation({ mutationFn: buildIndexVersion, onSuccess: invalidateIndexVersions });
}

export function usePromoteIndexVersion() {
  const invalidateIndexVersions = useInvalidateIndexVersions();
  return useMutation({ mutationFn: promoteIndexVersion, onSuccess: invalidateIndexVersions });
}

export function useDeleteIndexVersion() {
  const invalidateIndexVersions = useInvalidateIndexVersions();
  return useMutation({ mutationFn: deleteIndexVersion, onSuccess: invalidateIndexVersions });
}
