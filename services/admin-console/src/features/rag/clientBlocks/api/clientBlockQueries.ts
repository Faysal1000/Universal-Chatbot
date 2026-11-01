import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { clientBlockQueryKeys } from './clientBlockQueryKeys';
import type { ClientBlockCreateRequest } from './clientBlockTypes';
import { createClientBlock, deleteClientBlock, listClientBlocks } from './clientBlocksApi';

export function useClientBlocks() {
  return useQuery({ queryKey: clientBlockQueryKeys.all, queryFn: listClientBlocks });
}

function useInvalidateClientBlocks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: clientBlockQueryKeys.all });
}

export function useCreateClientBlock() {
  const invalidateClientBlocks = useInvalidateClientBlocks();
  return useMutation({
    mutationFn: (request: ClientBlockCreateRequest) => createClientBlock(request),
    onSuccess: invalidateClientBlocks,
  });
}

export function useDeleteClientBlock() {
  const invalidateClientBlocks = useInvalidateClientBlocks();
  return useMutation({
    mutationFn: (blockId: string) => deleteClientBlock(blockId),
    onSuccess: invalidateClientBlocks,
  });
}
