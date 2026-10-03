import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DeletedEffort,
  Effort,
  EffortPatchInput,
  Job,
  RecordsResponse,
  Sport,
} from '@rekordy/core';
import { apiFetch } from './client';

export const recordsKey = ['records'] as const;
const deletedKey = ['efforts', 'deleted'] as const;
const recomputeKey = ['admin', 'recompute-all'] as const;

export function useRecords(sport: Sport) {
  return useQuery({
    queryKey: [...recordsKey, sport],
    queryFn: () => apiFetch<RecordsResponse>(`/api/records?sport=${sport}`),
  });
}

export function useDeletedEfforts(sport: Sport | undefined) {
  return useQuery({
    queryKey: [...deletedKey, sport ?? 'all'],
    queryFn: () =>
      apiFetch<DeletedEffort[]>(
        sport ? `/api/efforts/deleted?sport=${sport}` : '/api/efforts/deleted',
      ),
  });
}

/**
 * A result change shows up in the records, the deleted list and the activity details (its
 * results and link), so all of them are refreshed.
 */
export function useInvalidateResults() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [recordsKey, ['efforts'], ['activities']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

export function usePatchEffort() {
  const invalidate = useInvalidateResults();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: EffortPatchInput }) =>
      apiFetch<Effort>(`/api/efforts/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: invalidate,
  });
}

export function useDeleteEffort() {
  const invalidate = useInvalidateResults();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/efforts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

/** Restores a deleted result; null when it no longer qualifies and was dropped. */
export function useRestoreEffort() {
  const invalidate = useInvalidateResults();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<Effort | null>(`/api/efforts/${id}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

/** Drops the manual edit of a computed result (recomputed from the activity). */
export function useResetEffort() {
  const invalidate = useInvalidateResults();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<Effort | null>(`/api/efforts/${id}/reset`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

/** The newest recompute-all job (running, interrupted or finished), or null. */
export function useLatestRecomputeJob() {
  return useQuery({
    queryKey: recomputeKey,
    queryFn: async () => (await apiFetch<{ job: Job | null }>('/api/admin/recompute-all')).job,
  });
}

/** Starts a recompute-all job, or returns the one already running. */
export function startRecomputeAll(): Promise<Job> {
  return apiFetch<Job>('/api/admin/recompute-all', { method: 'POST' });
}

/** Processes the next chunk of a job. */
export function runJobChunk(id: number): Promise<Job> {
  return apiFetch<Job>(`/api/admin/jobs/${id}/run`, { method: 'POST' });
}
