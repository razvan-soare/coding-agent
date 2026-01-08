import { v4 as uuid } from 'uuid';
import { getDb } from './client.js';
import type { Milestone, MilestoneStatus } from './types.js';

export function createMilestone(data: {
  project_id: string;
  title: string;
  description?: string;
  order_index?: number;
}): Milestone {
  const db = getDb();
  const id = uuid();

  const maxOrder = db.prepare(
    'SELECT MAX(order_index) as max FROM milestones WHERE project_id = ?'
  ).get(data.project_id) as { max: number | null };

  const orderIndex = data.order_index ?? (maxOrder.max ?? -1) + 1;

  db.prepare(`
    INSERT INTO milestones (id, project_id, title, description, order_index)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.project_id, data.title, data.description ?? null, orderIndex);

  return getMilestone(id)!;
}

export function getMilestone(id: string): Milestone | null {
  const db = getDb();
  return db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone | null;
}

export function getMilestonesByProject(projectId: string, includeArchived = false): Milestone[] {
  const db = getDb();
  const query = includeArchived
    ? 'SELECT * FROM milestones WHERE project_id = ? ORDER BY order_index ASC'
    : 'SELECT * FROM milestones WHERE project_id = ? AND (archived = 0 OR archived IS NULL) ORDER BY order_index ASC';
  return db.prepare(query).all(projectId) as Milestone[];
}

export function getCurrentMilestone(projectId: string): Milestone | null {
  const db = getDb();
  return db.prepare(`
    SELECT m.* FROM milestones m
    JOIN projects p ON p.current_milestone_id = m.id
    WHERE p.id = ?
  `).get(projectId) as Milestone | null;
}

export function getNextPendingMilestone(projectId: string): Milestone | null {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM milestones
    WHERE project_id = ? AND status = 'pending' AND (archived = 0 OR archived IS NULL)
    ORDER BY order_index ASC
    LIMIT 1
  `).get(projectId) as Milestone | null;
}

export function getNextMilestone(projectId: string, currentOrderIndex: number): Milestone | null {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM milestones
    WHERE project_id = ? AND order_index > ?
    ORDER BY order_index ASC
    LIMIT 1
  `).get(projectId, currentOrderIndex) as Milestone | null;
}

export function updateMilestoneStatus(id: string, status: MilestoneStatus): Milestone | null {
  const db = getDb();
  db.prepare('UPDATE milestones SET status = ? WHERE id = ?').run(status, id);
  return getMilestone(id);
}

export function deleteMilestone(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM milestones WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateMilestoneArchived(id: string, archived: boolean): Milestone | null {
  const db = getDb();
  db.prepare('UPDATE milestones SET archived = ? WHERE id = ?').run(archived ? 1 : 0, id);
  return getMilestone(id);
}

export function updateMilestone(id: string, data: { title?: string; description?: string }): Milestone | null {
  const db = getDb();
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    values.push(data.title);
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    values.push(data.description);
  }

  if (updates.length === 0) return getMilestone(id);

  values.push(id);
  db.prepare(`UPDATE milestones SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getMilestone(id);
}
