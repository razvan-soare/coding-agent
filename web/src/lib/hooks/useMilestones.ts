import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed';

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  order_index: number;
  status: MilestoneStatus;
  archived: number;
  created_at: string;
}

async function fetchMilestones(projectId: string, includeArchived: boolean): Promise<Milestone[]> {
  const res = await fetch(
    `/api/milestones?project_id=${projectId}&include_archived=${includeArchived}`
  );
  if (!res.ok) throw new Error('Failed to fetch milestones');
  const data = await res.json();
  return data.milestones;
}

async function createMilestone(data: {
  project_id: string;
  title: string;
  description?: string;
}): Promise<Milestone> {
  const res = await fetch('/api/milestones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create milestone');
  const result = await res.json();
  return result.milestone;
}

async function updateMilestone(
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    status: MilestoneStatus;
    archived: number;
  }>
): Promise<Milestone> {
  const res = await fetch(`/api/milestones/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update milestone');
  const result = await res.json();
  return result.milestone;
}

async function deleteMilestone(id: string): Promise<void> {
  const res = await fetch(`/api/milestones/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete milestone');
}

export function useMilestones(projectId: string, includeArchived = false) {
  return useQuery({
    queryKey: ['milestones', projectId, includeArchived],
    queryFn: () => fetchMilestones(projectId, includeArchived),
    enabled: !!projectId,
  });
}

export function useCreateMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMilestone,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['milestones', data.project_id] });
    },
  });
}

export function useUpdateMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Parameters<typeof updateMilestone>[1]) =>
      updateMilestone(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['milestones', data.project_id] });
    },
  });
}

export function useDeleteMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) => deleteMilestone(id),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['milestones', projectId] });
    },
  });
}

export function useBulkCreateMilestones() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      project_id: string;
      milestones: Array<{ title: string; description?: string }>;
    }) => {
      const results = await Promise.all(
        data.milestones.map((m) =>
          createMilestone({ ...m, project_id: data.project_id })
        )
      );
      return results;
    },
    onSuccess: (data) => {
      if (data.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['milestones', data[0].project_id] });
      }
    },
  });
}
