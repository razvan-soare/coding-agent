import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type KnowledgeCategory = 'pattern' | 'gotcha' | 'decision' | 'preference' | 'file_note';

export interface Knowledge {
  id: string;
  project_id: string;
  category: KnowledgeCategory;
  tags: string;  // JSON array stored as string
  file_path: string | null;
  content: string;
  importance: number;
  source_task_id: string | null;
  created_at: string;
  last_used_at: string;
}

async function fetchKnowledge(projectId: string): Promise<Knowledge[]> {
  const res = await fetch(`/api/knowledge?project_id=${projectId}`);
  if (!res.ok) throw new Error('Failed to fetch knowledge');
  const data = await res.json();
  return data.knowledge;
}

async function createKnowledge(data: {
  project_id: string;
  category: KnowledgeCategory;
  tags: string[];
  content: string;
  file_path?: string;
  importance?: number;
}): Promise<Knowledge> {
  const res = await fetch('/api/knowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create knowledge');
  const result = await res.json();
  return result.knowledge;
}

async function updateKnowledge(
  id: string,
  data: Partial<{
    category: KnowledgeCategory;
    tags: string[];
    content: string;
    file_path: string | null;
    importance: number;
  }>
): Promise<Knowledge> {
  const res = await fetch(`/api/knowledge/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update knowledge');
  const result = await res.json();
  return result.knowledge;
}

async function deleteKnowledge(id: string): Promise<void> {
  const res = await fetch(`/api/knowledge/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete knowledge');
}

export function useKnowledge(projectId: string) {
  return useQuery({
    queryKey: ['knowledge', projectId],
    queryFn: () => fetchKnowledge(projectId),
    enabled: !!projectId,
  });
}

export function useCreateKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createKnowledge,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge', data.project_id] });
    },
  });
}

export function useUpdateKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Parameters<typeof updateKnowledge>[1]) =>
      updateKnowledge(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge', data.project_id] });
    },
  });
}

export function useDeleteKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) => deleteKnowledge(id),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge', projectId] });
    },
  });
}
