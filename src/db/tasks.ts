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

export function getNextPendingTask(projectId: string, currentMilestoneId?: string): Task | null {
  const db = getDb();

  // If we have a current milestone, prioritize tasks from that milestone by order_index
  if (currentMilestoneId) {
    // First, check for pending tasks in the current milestone (ordered by order_index)
    const milestoneTask = db.prepare(`
      SELECT * FROM tasks
      WHERE project_id = ? AND milestone_id = ? AND status = 'pending'
      ORDER BY order_index ASC
      LIMIT 1
    `).get(projectId, currentMilestoneId) as Task | null;

    if (milestoneTask) {
      return milestoneTask;
    }
  }

  // Fall back to regular priority-based ordering (for injected tasks or tasks without milestone)
  return db.prepare(`
    SELECT * FROM tasks
    WHERE project_id = ? AND status = 'pending'
    ORDER BY priority DESC, order_index ASC, created_at ASC
    LIMIT 1
  `).get(projectId) as Task | null;
}

export function getCompletedTasks(projectId: string, milestoneId?: string): Task[] {
  const db = getDb();
  if (milestoneId) {
    return db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND milestone_id = ? AND status = 'completed' ORDER BY updated_at ASC"
    ).all(projectId, milestoneId) as Task[];
  }
  // If no milestone, return last 10 completed tasks to keep prompt short
  return db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND status = 'completed' ORDER BY updated_at DESC LIMIT 10"
  ).all(projectId) as Task[];
}

export function getFailedTasks(projectId: string, milestoneId?: string): Task[] {
  const db = getDb();
  if (milestoneId) {
    return db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND milestone_id = ? AND status = 'failed' ORDER BY updated_at ASC"
    ).all(projectId, milestoneId) as Task[];
  }
  return db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 5"
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

export function createInjectedTask(data: {
  project_id: string;
  title: string;
  description: string;
  milestone_id?: string;
  priority?: number;
}): Task {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();
  const priority = data.priority ?? 100; // Default high priority for injected tasks

  db.prepare(`
    INSERT INTO tasks (id, project_id, milestone_id, title, description, priority, is_injected, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, data.project_id, data.milestone_id ?? null, data.title, data.description, priority, now, now);

  return getTask(id)!;
}

export function updateTaskPriority(id: string, priority: number): Task | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?').run(priority, now, id);
  return getTask(id);
}

/**
 * Create multiple tasks for a milestone with proper ordering.
 * Tasks are created in order with order_index starting from 0.
 */
export function createTasksForMilestone(data: {
  project_id: string;
  milestone_id: string;
  tasks: Array<{ title: string; description: string }>;
}): Task[] {
  const db = getDb();
  const now = new Date().toISOString();
  const createdTasks: Task[] = [];

  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, project_id, milestone_id, title, description, order_index, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < data.tasks.length; i++) {
    const task = data.tasks[i];
    const id = uuid();

    insertStmt.run(id, data.project_id, data.milestone_id, task.title, task.description, i, now, now);
    createdTasks.push(getTask(id)!);
  }

  return createdTasks;
}

/**
 * Check if a milestone has any incomplete tasks (pending, in_progress, or review).
 */
export function hasPendingMilestoneTasks(milestoneId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM tasks
    WHERE milestone_id = ? AND status IN ('pending', 'in_progress', 'review')
  `).get(milestoneId) as { count: number };

  return result.count > 0;
}

/**
 * Get the count of tasks by status for a milestone.
 */
export function getMilestoneTaskStats(milestoneId: string): {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
} {
  const db = getDb();
  const tasks = db.prepare(
    'SELECT status FROM tasks WHERE milestone_id = ?'
  ).all(milestoneId) as Array<{ status: TaskStatus }>;

  return {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress' || t.status === 'review').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  };
}
