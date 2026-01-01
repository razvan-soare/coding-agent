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
export interface Project {
  id: string;
  name: string;
  path: string;
  overview_path: string;
  current_milestone_id: string | null;
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

export interface Run {
  id: string;
  project_id: string;
  task_id: string | null;
  status: 'running' | 'completed' | 'failed';
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

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  order_index: number;
  status: 'pending' | 'in_progress' | 'completed';
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
