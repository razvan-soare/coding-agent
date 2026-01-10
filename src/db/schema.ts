import { getDb } from './client.js';

function columnExists(tableName: string, columnName: string): boolean {
  const db = getDb();
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some(col => col.name === columnName);
}

function runMigrations(): void {
  const db = getDb();

  // Migration: Add priority and is_injected columns to tasks table
  if (!columnExists('tasks', 'priority')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC)`);
  }

  if (!columnExists('tasks', 'is_injected')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN is_injected INTEGER NOT NULL DEFAULT 0`);
  }

  // Migration: Add use_knowledge column to projects table
  if (!columnExists('projects', 'use_knowledge')) {
    db.exec(`ALTER TABLE projects ADD COLUMN use_knowledge INTEGER NOT NULL DEFAULT 1`);
  }

  // Migration: Add cron_enabled column to projects table
  if (!columnExists('projects', 'cron_enabled')) {
    db.exec(`ALTER TABLE projects ADD COLUMN cron_enabled INTEGER NOT NULL DEFAULT 0`);
  }

  // Migration: Add cron_schedule column to projects table (default: every 3 hours)
  if (!columnExists('projects', 'cron_schedule')) {
    db.exec(`ALTER TABLE projects ADD COLUMN cron_schedule TEXT NOT NULL DEFAULT '0 */3 * * *'`);
  }

  // Migration: Add trigger_source column to runs table
  if (!columnExists('runs', 'trigger_source')) {
    db.exec(`ALTER TABLE runs ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'cli'`);
  }

  // Migration: Add archived column to milestones table
  if (!columnExists('milestones', 'archived')) {
    db.exec(`ALTER TABLE milestones ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_milestones_archived ON milestones(archived)`);
  }

  // Migration: Add order_index column to tasks table (for ordering within milestone)
  if (!columnExists('tasks', 'order_index')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_order ON tasks(milestone_id, order_index)`);
  }

  // Migration: Add import_mode column to projects table ('in_place' | 'reference' | null)
  if (!columnExists('projects', 'import_mode')) {
    db.exec(`ALTER TABLE projects ADD COLUMN import_mode TEXT`);
  }

  // Migration: Add reference_path column to projects table (path to reference repo)
  if (!columnExists('projects', 'reference_path')) {
    db.exec(`ALTER TABLE projects ADD COLUMN reference_path TEXT`);
  }

  // Migration: Add repository_url column to projects table (original GitHub URL if cloned)
  if (!columnExists('projects', 'repository_url')) {
    db.exec(`ALTER TABLE projects ADD COLUMN repository_url TEXT`);
  }

  // Migration: Add git_author_name column to projects table (custom commit author name)
  if (!columnExists('projects', 'git_author_name')) {
    db.exec(`ALTER TABLE projects ADD COLUMN git_author_name TEXT`);
  }

  // Migration: Add git_author_email column to projects table (custom commit author email)
  if (!columnExists('projects', 'git_author_email')) {
    db.exec(`ALTER TABLE projects ADD COLUMN git_author_email TEXT`);
  }
}

export function initializeSchema(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      overview_path TEXT NOT NULL,
      current_milestone_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      milestone_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      comments TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      git_commit_sha TEXT,
      summary TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      event TEXT NOT NULL,
      prompt TEXT,
      response TEXT,
      metadata TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'pattern',
      tags TEXT NOT NULL DEFAULT '[]',
      file_path TEXT,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 5,
      source_task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_logs_run ON logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_importance ON knowledge(importance DESC);
  `);

  // Run migrations for existing databases
  runMigrations();
}
