'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project, Task, Run } from '@/lib/db';

interface ProjectStats {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  lastRun: Run | null;
}

interface ProjectWithStats extends Project {
  stats: ProjectStats;
}

interface ProjectDetail extends Project {
  stats: ProjectStats;
  tasks: Task[];
  runs: Run[];
}

export function useProjects() {
  return useQuery<ProjectWithStats[]>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      return res.json();
    },
  });
}

export function useProject(id: string) {
  return useQuery<ProjectDetail>({
    queryKey: ['project', id],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) throw new Error('Failed to fetch project');
      return res.json();
    },
    enabled: !!id,
  });
}
