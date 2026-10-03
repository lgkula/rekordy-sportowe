import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityCreateInput,
  ActivityDetail,
  ActivityListQuery,
  ActivityListResponse,
  ActivityPatchInput,
} from '@rekordy/core';
import { apiFetch } from './client';

const activitiesKey = ['activities'] as const;

function listUrl(query: ActivityListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/api/activities?${search}` : '/api/activities';
}

export function useActivities(query: ActivityListQuery) {
  return useQuery({
    queryKey: [...activitiesKey, 'list', query],
    queryFn: () => apiFetch<ActivityListResponse>(listUrl(query)),
    // Keep the current page visible while the next sort / page loads.
    placeholderData: keepPreviousData,
  });
}

export function useActivity(id: number | undefined) {
  return useQuery({
    queryKey: [...activitiesKey, 'detail', id],
    queryFn: () => apiFetch<ActivityDetail>(`/api/activities/${id}`),
    enabled: id !== undefined,
  });
}

/**
 * Mutations refresh every activity query (list pages and details) and the races view, which
 * shows race activities as editions.
 */
function useInvalidateActivities() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [activitiesKey, ['events']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

export function useCreateActivity() {
  const invalidate = useInvalidateActivities();
  return useMutation({
    mutationFn: (body: ActivityCreateInput & { confirmDuplicate?: boolean }) =>
      apiFetch<ActivityDetail>('/api/activities', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function usePatchActivity() {
  const invalidate = useInvalidateActivities();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ActivityPatchInput }) =>
      apiFetch<ActivityDetail>(`/api/activities/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: invalidate,
  });
}

export function useDeleteActivity() {
  const invalidate = useInvalidateActivities();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/activities/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
