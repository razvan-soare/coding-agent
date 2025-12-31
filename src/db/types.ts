export interface Project {
  id: string;
  name: string;
  path: string;
  overview_path: string;
  current_milestone_id: string | null;
  created_at: string;
  updated_at: string;
}

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed';

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  order_index: number;
  status: MilestoneStatus;
  created_at: string;
}

export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'failed' | 'completed';

export interface Task {
  id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  retry_count: number;
  priority: number;
  is_injected: number;
  comments: string | null;
  created_at: string;
  updated_at: string;
}

export type RunStatus = 'running' | 'completed' | 'failed';

export interface Run {
  id: string;
  project_id: string;
  task_id: string | null;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  git_commit_sha: string | null;
  summary: string | null;
}

export type AgentType = 'planner' | 'developer' | 'reviewer' | 'orchestrator';
export type LogEvent = 'started' | 'prompt_sent' | 'response_received' | 'error' | 'completed';

export interface Log {
  id: string;
  run_id: string;
  agent: AgentType;
  event: LogEvent;
  prompt: string | null;
  response: string | null;
  metadata: string | null;
  timestamp: string;
}
