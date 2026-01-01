export interface Project {
  id: string;
  name: string;
  path: string;
  overview_path: string;
  current_milestone_id: string | null;
  use_knowledge: number; // 1 = enabled, 0 = disabled
  cron_enabled: number; // 1 = enabled, 0 = disabled
  cron_schedule: string; // cron expression, default '0 */3 * * *' (every 3 hours)
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
export type TriggerSource = 'cli' | 'manual' | 'cron';

export interface Run {
  id: string;
  project_id: string;
  task_id: string | null;
  status: RunStatus;
  trigger_source: TriggerSource;
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
