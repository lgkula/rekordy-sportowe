import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, setUnauthorizedHandler } from '../api/client';
import { pl } from '../i18n/pl';
import { defaultPath } from '../navigation';

export type Role = 'viewer' | 'editor';
export type Me = { role: Role; remember: boolean };

export const meQueryKey = ['auth', 'me'] as const;

async function fetchMe(): Promise<Me | null> {
  try {
    return await apiFetch<Me>('/api/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Current session: `data` is null when logged out. Changes only through the mutations below. */
export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: Infinity, retry: 1 });
}

/** True when editor-only controls should be shown. The server checks the role anyway. */
export function useCanEdit(): boolean {
  return useMe().data?.role === 'editor';
}

/** Any API call answering 401 means the session is gone: the route guard then shows /login. */
export function installUnauthorizedHandler(queryClient: QueryClient): void {
  setUnauthorizedHandler(() => queryClient.setQueryData(meQueryKey, null));
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { password: string; remember: boolean }) =>
      apiFetch<Me>('/api/auth/login', { method: 'POST', body }),
    onSuccess: (me) => queryClient.setQueryData(meQueryKey, me),
  });
}

export function useSwitchRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { targetRole: Role; password?: string }) =>
      apiFetch<Me>('/api/auth/switch', { method: 'POST', body }),
    onSuccess: (me) => queryClient.setQueryData(meQueryKey, me),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(meQueryKey, null);
    },
  });
}

/** Polish message for a failed login or role switch. */
export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return pl.auth.errors.generic;
  switch (error.status) {
    case 0:
      return pl.auth.errors.network;
    case 401:
    case 403:
      return pl.auth.errors.invalidPassword;
    case 429:
      return pl.auth.errors.tooManyAttempts;
    case 503:
      return pl.auth.errors.notConfigured;
    default:
      return pl.auth.errors.generic;
  }
}

/** Where to go after login: only same-app paths, never back to /login or another origin. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return defaultPath;
  }
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) {
    return defaultPath;
  }
  return next;
}

export function loginPath(next: string): string {
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
