import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface ProjectInstance {
  projectId: string;
  projectPath: string;
  port: number;
  pid: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  error?: string;
}

async function fetchInstance(projectId: string): Promise<ProjectInstance | null> {
  const res = await fetch(`/api/projects/${projectId}/instance`);
  if (!res.ok) throw new Error('Failed to fetch instance');
  const data = await res.json();
  return data.instance;
}

async function startInstance(projectId: string): Promise<{ instance: ProjectInstance; message: string }> {
  const res = await fetch(`/api/projects/${projectId}/instance`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to start instance');
  return res.json();
}

async function stopInstance(projectId: string): Promise<{ instance: ProjectInstance; message: string }> {
  const res = await fetch(`/api/projects/${projectId}/instance`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to stop instance');
  return res.json();
}

export function useInstance(projectId: string) {
  return useQuery({
    queryKey: ['instance', projectId],
    queryFn: () => fetchInstance(projectId),
    refetchInterval: 2000, // Poll every 2 seconds to check status
    enabled: !!projectId,
  });
}

export function useStartInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => startInstance(projectId),
    onSuccess: (data, projectId) => {
      queryClient.setQueryData(['instance', projectId], data.instance);
    },
  });
}

export function useStopInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => stopInstance(projectId),
    onSuccess: (data, projectId) => {
      queryClient.setQueryData(['instance', projectId], data.instance);
    },
  });
}
