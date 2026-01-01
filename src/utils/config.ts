import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');

config({ path: resolve(projectRoot, '.env') });

export const CONFIG = {
  databasePath: process.env.DATABASE_PATH || resolve(projectRoot, 'data/coding-agent.db'),
  inactivityTimeoutMs: parseInt(process.env.INACTIVITY_TIMEOUT_MS || '600000', 10),
  claudeCodePath: process.env.CLAUDE_CODE_PATH || 'claude',
  projectsDir: resolve(projectRoot, 'projects'),
  projectRoot,
} as const;
