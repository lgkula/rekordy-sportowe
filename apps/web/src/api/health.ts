import { useQuery } from '@tanstack/react-query';

export type Health = {
  status: 'ok' | 'degraded';
  version: string;
};

async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/health', { headers: { accept: 'application/json' } });
  // 503 still carries a JSON body describing what is wrong.
  if (!res.ok && res.status !== 503) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Health;
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 60_000,
    retry: 1,
  });
}
