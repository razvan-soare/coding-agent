import { v4 as uuid } from 'uuid';
import { getDb } from './client.js';
import type { Run, RunStatus } from './types.js';

export function createRun(projectId: string, taskId?: string): Run {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO runs (id, project_id, task_id, started_at)
    VALUES (?, ?, ?, ?)
  `).run(id, projectId, taskId ?? null, now);

  return getRun(id)!;
}

export function getRun(id: string): Run | null {
  const db = getDb();
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run | null;
}

export function getRunsByProject(projectId: string, limit = 50): Run[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?'
  ).all(projectId, limit) as Run[];
}

export function getRunsByTask(taskId: string): Run[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC'
  ).all(taskId) as Run[];
}

export function updateRunStatus(id: string, status: RunStatus): Run | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE runs SET status = ?, finished_at = ? WHERE id = ?').run(status, now, id);
  return getRun(id);
}

export function updateRunTask(id: string, taskId: string): Run | null {
  const db = getDb();
  db.prepare('UPDATE runs SET task_id = ? WHERE id = ?').run(taskId, id);
  return getRun(id);
}

export function updateRunCommit(id: string, commitSha: string): Run | null {
  const db = getDb();
  db.prepare('UPDATE runs SET git_commit_sha = ? WHERE id = ?').run(commitSha, id);
  return getRun(id);
}

export function updateRunSummary(id: string, summary: string): Run | null {
  const db = getDb();
  db.prepare('UPDATE runs SET summary = ? WHERE id = ?').run(summary, id);
  return getRun(id);
}

export function finishRun(id: string, status: RunStatus, summary?: string, commitSha?: string): Run | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE runs
    SET status = ?, finished_at = ?, summary = COALESCE(?, summary), git_commit_sha = COALESCE(?, git_commit_sha)
    WHERE id = ?
  `).run(status, now, summary ?? null, commitSha ?? null, id);
  return getRun(id);
}
