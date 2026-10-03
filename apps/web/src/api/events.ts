import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  eventOrderingKey,
  type EventCreateInput,
  type EventDetail,
  type EventListResponse,
  type EventOrdering,
  type EventPatchInput,
  type EventSuggestion,
  type Sport,
} from '@rekordy/core';
import { apiFetch } from './client';

export const eventsKey = ['events'] as const;

export function useEvents(sport: Sport) {
  return useQuery({
    queryKey: [...eventsKey, 'list', sport],
    queryFn: () => apiFetch<EventListResponse>(`/api/events?sport=${sport}`),
  });
}

export function useEvent(id: number | null) {
  return useQuery({
    queryKey: [...eventsKey, 'detail', id],
    queryFn: () => apiFetch<EventDetail>(`/api/events/${id}`),
    enabled: id !== null,
  });
}

/** Events with a name similar to `name` (empty name: none). */
export function useEventSuggestions(sport: Sport, name: string) {
  const trimmed = name.trim();
  return useQuery({
    queryKey: [...eventsKey, 'suggest', sport, trimmed],
    queryFn: () =>
      apiFetch<EventSuggestion[]>(
        `/api/events/suggest?sport=${sport}&name=${encodeURIComponent(trimmed)}`,
      ),
    enabled: trimmed !== '',
    staleTime: 30_000,
  });
}

/**
 * Event changes show up in the races list, the event details and the activities (event name,
 * race flag), so all of them are refreshed.
 */
export function useInvalidateEvents() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [eventsKey, ['activities']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

export function useCreateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (body: EventCreateInput) =>
      apiFetch<EventDetail>('/api/events', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function usePatchEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: EventPatchInput }) =>
      apiFetch<EventDetail>(`/api/events/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/events/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useMergeEvents() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number }) =>
      apiFetch<EventDetail>(`/api/events/${id}/merge`, { method: 'POST', body: { targetId } }),
    onSuccess: invalidate,
  });
}

/** Saves the manual order; the list is reordered in the cache right away (no flicker). */
export function useSaveEventOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sport, ids }: { sport: Sport; ids: number[] }) =>
      apiFetch<void>('/api/events/order', { method: 'PUT', body: { sport, ids } }),
    onMutate: ({ sport, ids }) => {
      const key = [...eventsKey, 'list', sport];
      queryClient.setQueryData<EventListResponse>(key, (data) => {
        if (!data) return data;
        const position = new Map(ids.map((id, index) => [id, index]));
        return {
          ...data,
          events: data.events.map((e) =>
            e.id !== null && position.has(e.id) ? { ...e, sortOrder: position.get(e.id)! } : e,
          ),
        };
      });
    },
    onSettled: (_data, _error, { sport }) =>
      queryClient.invalidateQueries({ queryKey: [...eventsKey, 'list', sport] }),
  });
}

/** Saves the ordering mode of a sport's races list. */
export function useSaveEventOrdering() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sport, ordering }: { sport: Sport; ordering: EventOrdering }) =>
      apiFetch(`/api/settings/${eventOrderingKey(sport)}`, {
        method: 'PUT',
        body: { value: ordering },
      }),
    onMutate: ({ sport, ordering }) => {
      queryClient.setQueryData<EventListResponse>([...eventsKey, 'list', sport], (data) =>
        data ? { ...data, ordering } : data,
      );
    },
    onSettled: (_data, _error, { sport }) =>
      queryClient.invalidateQueries({ queryKey: [...eventsKey, 'list', sport] }),
  });
}
