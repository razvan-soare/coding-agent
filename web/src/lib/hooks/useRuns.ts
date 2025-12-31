'use client';

import { useQuery } from '@tanstack/react-query';
import type { Run, Log } from '@/lib/db';

export function useRuns(projectId: string, limit = 20) {
  return useQuery<Run[]>({
    queryKey: ['runs', projectId, limit],
    queryFn: async () => {
      const res = await fetch(`/api/runs?project_id=${projectId}&limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch runs');
      return res.json();
    },
    enabled: !!projectId,
  });
}

export function useRun(id: string) {
  return useQuery<Run>({
    queryKey: ['run', id],
    queryFn: async () => {
      const res = await fetch(`/api/runs/${id}`);
      if (!res.ok) throw new Error('Failed to fetch run');
      return res.json();
    },
    enabled: !!id,
  });
}

export function useLogs(runId: string) {
  return useQuery<Log[]>({
    queryKey: ['logs', runId],
    queryFn: async () => {
      const res = await fetch(`/api/runs/${runId}/logs`);
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    enabled: !!runId,
  });
}
