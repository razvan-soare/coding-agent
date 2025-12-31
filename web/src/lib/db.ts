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
