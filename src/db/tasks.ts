import { v4 as uuid } from 'uuid';
import { getDb } from './client.js';
import type { Task, TaskStatus } from './types.js';

export function createTask(data: {
  project_id: string;
  milestone_id?: string;
  title: string;
  description: string;
}): Task {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO tasks (id, project_id, milestone_id, title, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.project_id, data.milestone_id ?? null, data.title, data.description, now, now);

  return getTask(id)!;
}

export function getTask(id: string): Task | null {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | null;
}

export function getTasksByProject(projectId: string): Task[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC'
  ).all(projectId) as Task[];
}

export function getTasksByMilestone(milestoneId: string): Task[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM tasks WHERE milestone_id = ? ORDER BY created_at ASC'
  ).all(milestoneId) as Task[];
}

export function getTasksByStatus(projectId: string, status: TaskStatus): Task[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY created_at ASC'
  ).all(projectId, status) as Task[];
}

export function getNextPendingTask(projectId: string): Task | null {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM tasks
    WHERE project_id = ? AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
  `).get(projectId) as Task | null;
}

export function getCompletedTasks(projectId: string): Task[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND status = 'completed' ORDER BY updated_at ASC"
  ).all(projectId) as Task[];
}

export function updateTaskStatus(id: string, status: TaskStatus): Task | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  return getTask(id);
}

export function incrementTaskRetry(id: string): Task | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE tasks SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?').run(now, id);
  return getTask(id);
}

export function addTaskComment(id: string, comment: string): Task | null {
  const db = getDb();
  const task = getTask(id);
  if (!task) return null;

  const comments: string[] = task.comments ? JSON.parse(task.comments) : [];
  comments.push(comment);

  const now = new Date().toISOString();
  db.prepare('UPDATE tasks SET comments = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(comments), now, id);

  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}
