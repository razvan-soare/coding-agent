'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

interface RunStatus {
  running: boolean;
  pid?: number;
  startedAt?: string;
  cron?: {
    scheduled: boolean;
    nextRun?: string | null;
  };
}

export function useRunStatus(projectId: string, enabled = true) {
  return useQuery<RunStatus>({
    queryKey: ['runStatus', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/run`);
      if (!res.ok) throw new Error('Failed to check run status');
      return res.json();
    },
    enabled: !!projectId && enabled,
    refetchInterval: (query) => {
      // Poll every 2 seconds while a run is in progress
      return query.state.data?.running ? 2000 : false;
    },
  });
}

export function useTriggerRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await fetch(`/api/projects/${projectId}/run`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start run');
      }
      return res.json();
    },
    onSuccess: (data, projectId) => {
      // Invalidate run status to start polling
      queryClient.invalidateQueries({ queryKey: ['runStatus', projectId] });
      // Invalidate runs list to show new run when it completes
      queryClient.invalidateQueries({ queryKey: ['runs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
}
