import { v4 as uuid } from 'uuid';
import { getDb } from './client.js';
import type { Log, AgentType, LogEvent } from './types.js';

export function createLog(data: {
  run_id: string;
  agent: AgentType;
  event: LogEvent;
  prompt?: string;
  response?: string;
  metadata?: Record<string, unknown>;
}): Log {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO logs (id, run_id, agent, event, prompt, response, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.run_id,
    data.agent,
    data.event,
    data.prompt ?? null,
    data.response ?? null,
    data.metadata ? JSON.stringify(data.metadata) : null,
    now
  );

  return getLog(id)!;
}

export function getLog(id: string): Log | null {
  const db = getDb();
  return db.prepare('SELECT * FROM logs WHERE id = ?').get(id) as Log | null;
}

export function getLogsByRun(runId: string): Log[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM logs WHERE run_id = ? ORDER BY timestamp ASC'
  ).all(runId) as Log[];
}

export function getLogsByRunAndAgent(runId: string, agent: AgentType): Log[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM logs WHERE run_id = ? AND agent = ? ORDER BY timestamp ASC'
  ).all(runId, agent) as Log[];
}

export function getRecentLogs(runId: string, limit = 100): Log[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM logs WHERE run_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(runId, limit) as Log[];
}

export function logAgentStart(runId: string, agent: AgentType, prompt: string): Log {
  return createLog({
    run_id: runId,
    agent,
    event: 'started',
    prompt,
  });
}

export function logAgentPrompt(runId: string, agent: AgentType, prompt: string): Log {
  return createLog({
    run_id: runId,
    agent,
    event: 'prompt_sent',
    prompt,
  });
}

export function logAgentResponse(runId: string, agent: AgentType, response: string): Log {
  return createLog({
    run_id: runId,
    agent,
    event: 'response_received',
    response,
  });
}

export function logAgentError(runId: string, agent: AgentType, error: string, metadata?: Record<string, unknown>): Log {
  return createLog({
    run_id: runId,
    agent,
    event: 'error',
    response: error,
    metadata,
  });
}

export function logAgentComplete(runId: string, agent: AgentType, metadata?: Record<string, unknown>): Log {
  return createLog({
    run_id: runId,
    agent,
    event: 'completed',
    metadata,
  });
}
