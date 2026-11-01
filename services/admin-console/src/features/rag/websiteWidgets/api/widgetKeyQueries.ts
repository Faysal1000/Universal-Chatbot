import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { widgetKeyQueryKeys } from './widgetKeyQueryKeys';
import type { WidgetKeyCreateRequest, WidgetKeyUpdateRequest } from './widgetKeyTypes';
import { createWidgetKey, listWidgetKeys, revokeWidgetKey, updateWidgetKey } from './widgetKeysApi';

export function useWidgetKeys() {
  return useQuery({ queryKey: widgetKeyQueryKeys.all, queryFn: listWidgetKeys });
}

function useInvalidateWidgetKeys() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: widgetKeyQueryKeys.all });
}

export function useCreateWidgetKey() {
  const invalidateWidgetKeys = useInvalidateWidgetKeys();
  return useMutation({
    mutationFn: (request: WidgetKeyCreateRequest) => createWidgetKey(request),
    onSuccess: invalidateWidgetKeys,
  });
}

export function useUpdateWidgetKey() {
  const invalidateWidgetKeys = useInvalidateWidgetKeys();
  return useMutation({
    mutationFn: ({ widgetKeyId, request }: { widgetKeyId: string; request: WidgetKeyUpdateRequest }) =>
      updateWidgetKey(widgetKeyId, request),
    onSuccess: invalidateWidgetKeys,
  });
}

export function useRevokeWidgetKey() {
  const invalidateWidgetKeys = useInvalidateWidgetKeys();
  return useMutation({
    mutationFn: (widgetKeyId: string) => revokeWidgetKey(widgetKeyId),
    onSuccess: invalidateWidgetKeys,
  });
}
