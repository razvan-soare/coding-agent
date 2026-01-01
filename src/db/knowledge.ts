import { v4 as uuid } from 'uuid';
import { getDb } from './client.js';
import type { Knowledge, KnowledgeCategory } from './types.js';

export function createKnowledge(data: {
  project_id: string;
  category: KnowledgeCategory;
  tags: string[];
  content: string;
  file_path?: string;
  importance?: number;
  source_task_id?: string;
}): Knowledge {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO knowledge (id, project_id, category, tags, file_path, content, importance, source_task_id, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.project_id,
    data.category,
    JSON.stringify(data.tags),
    data.file_path ?? null,
    data.content,
    data.importance ?? 5,
    data.source_task_id ?? null,
    now,
    now
  );

  return getKnowledge(id)!;
}

export function getKnowledge(id: string): Knowledge | null {
  const db = getDb();
  return db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as Knowledge | null;
}

export function getKnowledgeByProject(projectId: string): Knowledge[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM knowledge WHERE project_id = ? ORDER BY importance DESC, last_used_at DESC'
  ).all(projectId) as Knowledge[];
}

export function getKnowledgeByCategory(projectId: string, category: KnowledgeCategory): Knowledge[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM knowledge WHERE project_id = ? AND category = ? ORDER BY importance DESC'
  ).all(projectId, category) as Knowledge[];
}

export function getKnowledgeByFilePath(projectId: string, filePath: string): Knowledge[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM knowledge WHERE project_id = ? AND file_path = ? ORDER BY importance DESC'
  ).all(projectId, filePath) as Knowledge[];
}

/**
 * Get relevant knowledge for a task based on:
 * 1. Keyword matching in tags and content
 * 2. File path matching
 * 3. Category preferences for different agents
 * 4. Importance and recency
 */
export function getRelevantKnowledge(
  projectId: string,
  options: {
    keywords?: string[];
    filePaths?: string[];
    categories?: KnowledgeCategory[];
    limit?: number;
  } = {}
): Knowledge[] {
  const db = getDb();
  const limit = options.limit ?? 10;

  // Build a query that scores relevance
  let query = `
    SELECT *,
      (
        CASE WHEN importance >= 8 THEN 3 ELSE 0 END +
        CASE WHEN julianday('now') - julianday(last_used_at) < 7 THEN 2 ELSE 0 END +
        CASE WHEN julianday('now') - julianday(last_used_at) < 30 THEN 1 ELSE 0 END
      ) as relevance_score
    FROM knowledge
    WHERE project_id = ?
  `;

  const params: (string | number)[] = [projectId];

  // Filter by categories if specified
  if (options.categories && options.categories.length > 0) {
    const placeholders = options.categories.map(() => '?').join(', ');
    query += ` AND category IN (${placeholders})`;
    params.push(...options.categories);
  }

  // Filter by file paths if specified
  if (options.filePaths && options.filePaths.length > 0) {
    const placeholders = options.filePaths.map(() => '?').join(', ');
    query += ` AND (file_path IS NULL OR file_path IN (${placeholders}))`;
    params.push(...options.filePaths);
  }

  query += ` ORDER BY relevance_score DESC, importance DESC, last_used_at DESC LIMIT ?`;
  params.push(limit);

  const results = db.prepare(query).all(...params) as (Knowledge & { relevance_score: number })[];

  // If keywords provided, filter and re-rank by keyword matching
  if (options.keywords && options.keywords.length > 0) {
    const lowerKeywords = options.keywords.map(k => k.toLowerCase());

    const scored = results.map(entry => {
      const tags = JSON.parse(entry.tags) as string[];
      const lowerTags = tags.map(t => t.toLowerCase());
      const lowerContent = entry.content.toLowerCase();

      let keywordScore = 0;
      for (const keyword of lowerKeywords) {
        if (lowerTags.some(tag => tag.includes(keyword))) keywordScore += 3;
        if (lowerContent.includes(keyword)) keywordScore += 1;
      }

      return { ...entry, keywordScore };
    });

    // Sort by keyword score, then relevance
    scored.sort((a, b) => {
      if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore;
      return b.relevance_score - a.relevance_score;
    });

    return scored.slice(0, limit);
  }

  return results;
}

/**
 * Get essential knowledge that should always be included (top importance)
 */
export function getEssentialKnowledge(projectId: string, limit = 5): Knowledge[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM knowledge
    WHERE project_id = ? AND importance >= 8
    ORDER BY importance DESC, last_used_at DESC
    LIMIT ?
  `).all(projectId, limit) as Knowledge[];
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

export function markKnowledgeUsed(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE knowledge SET last_used_at = ? WHERE id = ?').run(now, id);
}

export function deleteKnowledge(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Prune old, low-importance knowledge entries
 */
export function pruneKnowledge(projectId: string, options: {
  maxEntries?: number;
  maxAgeDays?: number;
} = {}): number {
  const db = getDb();
  const maxEntries = options.maxEntries ?? 100;
  const maxAgeDays = options.maxAgeDays ?? 90;

  // Delete old low-importance entries
  const result = db.prepare(`
    DELETE FROM knowledge
    WHERE project_id = ?
      AND importance < 5
      AND julianday('now') - julianday(last_used_at) > ?
  `).run(projectId, maxAgeDays);

  // If still over limit, delete least important/oldest
  const count = db.prepare('SELECT COUNT(*) as count FROM knowledge WHERE project_id = ?')
    .get(projectId) as { count: number };

  if (count.count > maxEntries) {
    const toDelete = count.count - maxEntries;
    db.prepare(`
      DELETE FROM knowledge
      WHERE id IN (
        SELECT id FROM knowledge
        WHERE project_id = ?
        ORDER BY importance ASC, last_used_at ASC
        LIMIT ?
      )
    `).run(projectId, toDelete);
  }

  return result.changes;
}

/**
 * Format knowledge entries for injection into agent prompts
 */
export function formatKnowledgeForPrompt(entries: Knowledge[]): string {
  if (entries.length === 0) return '';

  const categoryEmoji: Record<KnowledgeCategory, string> = {
    pattern: '📐',
    gotcha: '⚠️',
    decision: '📋',
    preference: '💡',
    file_note: '📁',
  };

  const lines = entries.map(entry => {
    const tags = JSON.parse(entry.tags) as string[];
    const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    const fileStr = entry.file_path ? ` (${entry.file_path})` : '';
    const emoji = categoryEmoji[entry.category as KnowledgeCategory] || '📝';

    return `${emoji} ${entry.content}${tagStr}${fileStr}`;
  });

  return lines.join('\n');
}
