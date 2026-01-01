import cron, { ScheduledTask } from 'node-cron';
import { spawn } from 'child_process';
import { resolve } from 'path';
import * as cronParserModule from 'cron-parser';
import { getAllProjects, getProject } from './db';

// cron-parser v5 exports CronExpressionParser as default
const CronParser = (cronParserModule as { default?: { parse: (expr: string, options?: { tz?: string }) => { next: () => { toDate: () => Date } } } }).default;

// Use global to persist cron state across hot-reloads in development
// This prevents multiple cron instances from being created
const globalForCron = globalThis as unknown as {
  __cronJobs?: Map<string, ScheduledTask>;
  __cronRunning?: Map<string, { pid: number; startedAt: Date }>;
  __cronInitialized?: boolean;
};

// Initialize or reuse existing maps
if (!globalForCron.__cronJobs) {
  globalForCron.__cronJobs = new Map<string, ScheduledTask>();
}
if (!globalForCron.__cronRunning) {
  globalForCron.__cronRunning = new Map<string, { pid: number; startedAt: Date }>();
}

const scheduledJobs = globalForCron.__cronJobs;
const runningProcesses = globalForCron.__cronRunning;

// Path to the CLI
const CLI_PATH = resolve(process.cwd(), '../dist/index.js');

/**
 * Start a cron job for a project
 */
export function startCronJob(projectId: string, schedule: string): boolean {
  // Stop existing job if any
  stopCronJob(projectId);

  // Validate cron expression
  if (!cron.validate(schedule)) {
    console.error(`[Cron] Invalid cron expression for project ${projectId}: ${schedule}`);
    return false;
  }

  const task = cron.schedule(schedule, async () => {
    await triggerCronRun(projectId);
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  scheduledJobs.set(projectId, task);
  console.log(`[Cron] Started job for project ${projectId} with schedule: ${schedule}`);
  return true;
}

/**
 * Stop a cron job for a project
 */
export function stopCronJob(projectId: string): void {
  const task = scheduledJobs.get(projectId);
  if (task) {
    task.stop();
    scheduledJobs.delete(projectId);
    console.log(`[Cron] Stopped job for project ${projectId}`);
  }
}

/**
 * Check if a cron job is scheduled for a project
 */
export function isJobScheduled(projectId: string): boolean {
  return scheduledJobs.has(projectId);
}

/**
 * Get the next run time for a project's cron job
 */
export function getNextRunTime(schedule: string): Date | null {
  if (!cron.validate(schedule)) return null;

  try {
    if (!CronParser) {
      console.error('[Cron] CronParser not available');
      return null;
    }
    const expression = CronParser.parse(schedule, { tz: 'UTC' });
    return expression.next().toDate();
  } catch (error) {
    console.error('[Cron] Error parsing cron expression:', error);
    return null;
  }
}

/**
 * Trigger a cron-initiated run
 */
async function triggerCronRun(projectId: string): Promise<void> {
  // Check if already running
  if (runningProcesses.has(projectId)) {
    console.log(`[Cron] Project ${projectId} already has a run in progress, skipping`);
    return;
  }

  // Verify project still has cron enabled
  const project = getProject(projectId);
  if (!project || project.cron_enabled !== 1) {
    console.log(`[Cron] Project ${projectId} cron disabled, stopping job`);
    stopCronJob(projectId);
    return;
  }

  console.log(`[Cron] Triggering scheduled run for project ${projectId}`);

  try {
    const child = spawn('node', [CLI_PATH, 'run', projectId, '--trigger', 'cron'], {
      cwd: resolve(process.cwd(), '..'),
      stdio: 'ignore',
      detached: true,
    });

    if (child.pid) {
      runningProcesses.set(projectId, { pid: child.pid, startedAt: new Date() });

      child.on('exit', (code) => {
        console.log(`[Cron] Run for project ${projectId} exited with code ${code}`);
        runningProcesses.delete(projectId);
      });

      child.on('error', (err) => {
        console.error(`[Cron] Error running project ${projectId}:`, err);
        runningProcesses.delete(projectId);
      });

      child.unref();
    }
  } catch (error) {
    console.error(`[Cron] Failed to trigger run for project ${projectId}:`, error);
  }
}

/**
 * Initialize cron jobs for all enabled projects
 */
export function initializeCronJobs(): void {
  console.log('[Cron] Initializing cron jobs...');

  const projects = getAllProjects();
  let enabledCount = 0;

  for (const project of projects) {
    if (project.cron_enabled === 1) {
      if (startCronJob(project.id, project.cron_schedule)) {
        enabledCount++;
      }
    }
  }

  console.log(`[Cron] Initialized ${enabledCount} cron jobs`);
}

/**
 * Update cron job when project settings change
 */
export function updateCronJob(projectId: string, enabled: boolean, schedule: string): void {
  if (enabled) {
    startCronJob(projectId, schedule);
  } else {
    stopCronJob(projectId);
  }
}

/**
 * Get cron status for a project
 */
export function getCronStatus(projectId: string): {
  scheduled: boolean;
  running: boolean;
  pid?: number;
  startedAt?: Date;
  nextRun?: Date | null;
} {
  const project = getProject(projectId);
  const isRunning = runningProcesses.has(projectId);
  const runInfo = runningProcesses.get(projectId);

  return {
    scheduled: scheduledJobs.has(projectId),
    running: isRunning,
    pid: runInfo?.pid,
    startedAt: runInfo?.startedAt,
    nextRun: project ? getNextRunTime(project.cron_schedule) : null,
  };
}

/**
 * Cleanup all cron jobs (for graceful shutdown)
 */
export function cleanupCronJobs(): void {
  console.log('[Cron] Cleaning up all cron jobs...');
  for (const [projectId] of scheduledJobs) {
    stopCronJob(projectId);
  }
  // Reset initialized flag so cron can be re-initialized if needed
  globalForCron.__cronInitialized = false;
}

// Initialize cron jobs only once, even across hot-reloads
export function ensureCronInitialized(): void {
  if (!globalForCron.__cronInitialized) {
    globalForCron.__cronInitialized = true;
    initializeCronJobs();
  }
}
