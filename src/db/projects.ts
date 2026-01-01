import { v4 as uuid } from 'uuid';
import { getDb } from './client.js';
import type { Project } from './types.js';

export function createProject(data: {
  name: string;
  path: string;
  overview_path: string;
}): Project {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, path, overview_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.path, data.overview_path, now, now);

  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
}

export function getProjectByPath(path: string): Project | null {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Project | null;
}

export function getAllProjects(): Project[] {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
}

export function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'current_milestone_id' | 'use_knowledge' | 'cron_enabled' | 'cron_schedule'>>): Project | null {
  const db = getDb();
  const updates: string[] = [];
  const values: unknown[] = [];

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

  if (updates.length === 0) return getProject(id);

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}
