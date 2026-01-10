import Database from 'better-sqlite3';
import { resolve } from 'path';

// Path to shared database (relative to web directory)
const DB_PATH = resolve(process.cwd(), '../data/coding-agent.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: false });
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// Types matching the main project
export type ImportMode = 'in_place' | 'reference';

export interface Project {
  id: string;
  name: string;
  path: string;
  overview_path: string;
  current_milestone_id: string | null;
  use_knowledge: number; // 1 = enabled, 0 = disabled
  cron_enabled: number; // 1 = enabled, 0 = disabled
  cron_schedule: string; // cron expression, default '0 */3 * * *'
  import_mode: ImportMode | null; // 'in_place' = work on existing repo, 'reference' = use as reference
  reference_path: string | null; // path to reference repo (for 'reference' mode)
  repository_url: string | null; // original GitHub URL if cloned
  git_author_name: string | null; // custom commit author name
  git_author_email: string | null; // custom commit author email
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'review' | 'failed' | 'completed';
  retry_count: number;
  priority: number;
  is_injected: number;
  comments: string | null;
  created_at: string;
  updated_at: string;
}

export type TriggerSource = 'cli' | 'manual' | 'cron';

export interface Run {
  id: string;
  project_id: string;
  task_id: string | null;
  status: 'running' | 'completed' | 'failed';
  trigger_source: TriggerSource;
  started_at: string;
  finished_at: string | null;
  git_commit_sha: string | null;
  summary: string | null;
}

export interface Log {
  id: string;
  run_id: string;
  agent: 'planner' | 'developer' | 'reviewer' | 'orchestrator';
  event: 'started' | 'prompt_sent' | 'response_received' | 'error' | 'completed';
  prompt: string | null;
  response: string | null;
  metadata: string | null;
  timestamp: string;
}

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed';

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  order_index: number;
  status: MilestoneStatus;
  archived: number; // 0 = active, 1 = archived
  created_at: string;
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

// Project operations
export function getAllProjects(): Project[] {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY name ASC').all() as Project[];
}

export function getProject(id: string): Project | null {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
}

export function updateProject(
  id: string,
  data: Partial<Pick<Project, 'name' | 'current_milestone_id' | 'use_knowledge' | 'cron_enabled' | 'cron_schedule' | 'repository_url' | 'git_author_name' | 'git_author_email'>>
): Project | null {
  const db = getDb();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.current_milestone_id !== undefined) {
    updates.push('current_milestone_id = ?');
    values.push(data.current_milestone_id);
  }
  if (data.use_knowledge !== undefined) {
    updates.push('use_knowledge = ?');
    values.push(data.use_knowledge);
  }
  if (data.cron_enabled !== undefined) {
    updates.push('cron_enabled = ?');
    values.push(data.cron_enabled);
  }
  if (data.cron_schedule !== undefined) {
    updates.push('cron_schedule = ?');
    values.push(data.cron_schedule);
  }
  if (data.repository_url !== undefined) {
    updates.push('repository_url = ?');
    values.push(data.repository_url);
  }
  if (data.git_author_name !== undefined) {
    updates.push('git_author_name = ?');
    values.push(data.git_author_name);
  }
  if (data.git_author_email !== undefined) {
    updates.push('git_author_email = ?');
    values.push(data.git_author_email);
  }

  if (updates.length === 0) return getProject(id);

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getProject(id);
}

// Task operations
export function getTasksByProject(projectId: string): Task[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at DESC'
  ).all(projectId) as Task[];
}

export function getTask(id: string): Task | null {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | null;
}

export function createInjectedTask(data: {
  project_id: string;
  title: string;
  description: string;
  priority?: number;
}): Task {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const priority = data.priority ?? 100;

  db.prepare(`
    INSERT INTO tasks (id, project_id, title, description, priority, is_injected, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, data.project_id, data.title, data.description, priority, now, now);

  return getTask(id)!;
}

export function updateTaskStatus(id: string, status: Task['status']): Task | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

// Run operations
export function getRunsByProject(projectId: string, limit = 20): Run[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?'
  ).all(projectId, limit) as Run[];
}

export function getRun(id: string): Run | null {
  const db = getDb();
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run | null;
}

export function getLogsByRun(runId: string): Log[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM logs WHERE run_id = ? ORDER BY timestamp ASC'
  ).all(runId) as Log[];
}

// Stats for dashboard
export function getProjectStats(projectId: string): {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  lastRun: Run | null;
} {
  const db = getDb();

  const counts = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM tasks
    WHERE project_id = ?
    GROUP BY status
  `).all(projectId) as Array<{ status: string; count: number }>;

  const stats = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    lastRun: null as Run | null,
  };

  for (const row of counts) {
    if (row.status === 'pending') stats.pending = row.count;
    if (row.status === 'in_progress') stats.in_progress = row.count;
    if (row.status === 'completed') stats.completed = row.count;
    if (row.status === 'failed') stats.failed = row.count;
  }

  stats.lastRun = db.prepare(
    'SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1'
  ).get(projectId) as Run | null;

  return stats;
}

// Knowledge operations
export function getKnowledgeByProject(projectId: string): Knowledge[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM knowledge WHERE project_id = ? ORDER BY importance DESC, last_used_at DESC'
  ).all(projectId) as Knowledge[];
}

export function getKnowledge(id: string): Knowledge | null {
  const db = getDb();
  return db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as Knowledge | null;
}

export function createKnowledge(data: {
  project_id: string;
  category: KnowledgeCategory;
  tags: string[];
  content: string;
  file_path?: string;
  importance?: number;
}): Knowledge {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO knowledge (id, project_id, category, tags, file_path, content, importance, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.project_id,
    data.category,
    JSON.stringify(data.tags),
    data.file_path ?? null,
    data.content,
    data.importance ?? 5,
    now,
    now
  );

  return getKnowledge(id)!;
}

export function updateKnowledge(
  id: string,
  data: Partial<{
    category: KnowledgeCategory;
    tags: string[];
    file_path: string | null;
    content: string;
    importance: number;
  }>
): Knowledge | null {
  const db = getDb();
  const existing = getKnowledge(id);
  if (!existing) return null;

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.category !== undefined) {
    updates.push('category = ?');
    params.push(data.category);
  }
  if (data.tags !== undefined) {
    updates.push('tags = ?');
    params.push(JSON.stringify(data.tags));
  }
  if (data.file_path !== undefined) {
    updates.push('file_path = ?');
    params.push(data.file_path);
  }
  if (data.content !== undefined) {
    updates.push('content = ?');
    params.push(data.content);
  }
  if (data.importance !== undefined) {
    updates.push('importance = ?');
    params.push(data.importance);
  }

  if (updates.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE knowledge SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  return getKnowledge(id);
}

export function deleteKnowledge(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
  return result.changes > 0;
}

// Milestone operations
export function getMilestonesByProject(projectId: string, includeArchived = false): Milestone[] {
  const db = getDb();
  const query = includeArchived
    ? 'SELECT * FROM milestones WHERE project_id = ? ORDER BY order_index ASC'
    : 'SELECT * FROM milestones WHERE project_id = ? AND (archived = 0 OR archived IS NULL) ORDER BY order_index ASC';
  return db.prepare(query).all(projectId) as Milestone[];
}

export function getMilestone(id: string): Milestone | null {
  const db = getDb();
  return db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone | null;
}

export function createMilestone(data: {
  project_id: string;
  title: string;
  description?: string;
}): Milestone {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const maxOrder = db.prepare(
    'SELECT MAX(order_index) as max FROM milestones WHERE project_id = ?'
  ).get(data.project_id) as { max: number | null };

  const orderIndex = (maxOrder.max ?? -1) + 1;

  db.prepare(`
    INSERT INTO milestones (id, project_id, title, description, order_index, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.project_id, data.title, data.description ?? null, orderIndex, now);

  return getMilestone(id)!;
}

export function updateMilestone(
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    status: MilestoneStatus;
    archived: number;
  }>
): Milestone | null {
  const db = getDb();
  const existing = getMilestone(id);
  if (!existing) return null;

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    params.push(data.title);
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    params.push(data.description);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    params.push(data.status);
  }
  if (data.archived !== undefined) {
    updates.push('archived = ?');
    params.push(data.archived);
  }

  if (updates.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE milestones SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  return getMilestone(id);
}

export function deleteMilestone(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM milestones WHERE id = ?').run(id);
  return result.changes > 0;
}

// Create project operation
export function createProject(data: {
  name: string;
  path: string;
  overview_path: string;
  use_knowledge?: number;
  cron_enabled?: number;
  cron_schedule?: string;
  import_mode?: ImportMode | null;
  reference_path?: string | null;
  repository_url?: string | null;
}): Project {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, path, overview_path, use_knowledge, cron_enabled, cron_schedule, import_mode, reference_path, repository_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.path,
    data.overview_path,
    data.use_knowledge ?? 0,
    data.cron_enabled ?? 0,
    data.cron_schedule ?? '0 */3 * * *',
    data.import_mode ?? null,
    data.reference_path ?? null,
    data.repository_url ?? null,
    now,
    now
  );

  return getProject(id)!;
}

export function getProjectByPath(path: string): Project | null {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Project | null;
}
