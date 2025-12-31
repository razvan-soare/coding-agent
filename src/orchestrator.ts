import {
  createRun,
  createTask,
  finishRun,
  getNextPendingTask,
  getProject,
  incrementTaskRetry,
  logAgentError,
  logAgentStart,
  logAgentComplete,
  updateRunTask,
  updateTaskStatus,
  addTaskComment,
  type Project,
  type Run,
  type Task,
} from './db/index.js';
import { runPlanner, runPlannerRecovery, type FailedTaskContext } from './agents/planner.js';
import { runDeveloper, type RetryContext } from './agents/developer.js';
import { runReviewer, formatReviewFeedback } from './agents/reviewer.js';
import { getGitStatus, stageAllChanges, commit, push, hasRemote, resetToLastCommit } from './git/operations.js';

const MAX_RETRIES = 3;

export interface OrchestratorResult {
  success: boolean;
  runId: string;
  taskId: string | null;
  commitSha: string | null;
  summary: string;
}

async function getOrCreateTask(run: Run, project: Project): Promise<Task | null> {
  // First, check for pending tasks
  let task = getNextPendingTask(project.id);

  if (task) {
    updateRunTask(run.id, task.id);
    return task;
  }

  // No pending tasks, run the planner
  console.log('No pending tasks. Running planner to generate new task...');

  const plannerResult = await runPlanner({
    runId: run.id,
    project,
  });

  if (!plannerResult.success) {
    console.error('Planner failed:', plannerResult.output.slice(0, 200));
    return null;
  }

  if (plannerResult.milestoneComplete) {
    console.log('Milestone complete! No more tasks to generate.');
    return null;
  }

  if (!plannerResult.task) {
    console.error('Planner did not return a valid task');
    return null;
  }

  // Create the new task
  task = createTask({
    project_id: project.id,
    title: plannerResult.task.title,
    description: plannerResult.task.description,
  });

  console.log(`Created task: ${task.title}`);
  updateRunTask(run.id, task.id);

  return task;
}

interface AttemptResult {
  success: boolean;
  timedOut: boolean;
  error?: string;
  reviewerFeedback?: string;
}

async function runDeveloperReviewerLoop(
  run: Run,
  project: Project,
  task: Task
): Promise<{ success: boolean; lastAttempt: AttemptResult }> {
  let lastAttempt: AttemptResult = { success: false, timedOut: false };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`\n--- Attempt ${attempt}/${MAX_RETRIES} ---`);

    // IMPROVEMENT 3: Reset git state before retry (except first attempt)
    if (attempt > 1) {
      console.log('Resetting git state to last commit...');
      const resetSuccess = resetToLastCommit(project.path);
      if (resetSuccess) {
        console.log('Git state reset successfully');
      } else {
        console.warn('Failed to reset git state, continuing anyway');
      }
    }

    // Update task status
    updateTaskStatus(task.id, 'in_progress');

    // IMPROVEMENT 1: Build retry context with error information
    const retryContext: RetryContext | undefined = attempt > 1 ? {
      attemptNumber: attempt,
      maxAttempts: MAX_RETRIES,
      previousError: lastAttempt.error,
      timedOut: lastAttempt.timedOut,
      reviewerFeedback: lastAttempt.reviewerFeedback,
    } : undefined;

    // Run developer
    console.log('Running developer agent...');
    const devResult = await runDeveloper({
      runId: run.id,
      project,
      task,
      retryContext,
    });

    if (!devResult.success) {
      console.error('Developer agent failed');
      lastAttempt = {
        success: false,
        timedOut: devResult.timedOut,
        error: devResult.timedOut
          ? 'Developer timed out due to inactivity'
          : 'Developer agent failed to complete',
      };
      incrementTaskRetry(task.id);
      continue;
    }

    // Check for changes
    const status = getGitStatus(project.path);
    if (!status.hasChanges) {
      console.log('Developer made no changes');
      return {
        success: true,
        lastAttempt: { success: true, timedOut: false },
      };
    }

    // Update task status for review
    updateTaskStatus(task.id, 'review');

    // Run reviewer
    console.log('Running reviewer agent...');
    const reviewResult = await runReviewer({
      runId: run.id,
      project,
    });

    if (!reviewResult.success || !reviewResult.review) {
      console.warn('Reviewer failed, proceeding with approval');
      return {
        success: true,
        lastAttempt: { success: true, timedOut: false },
      };
    }

    if (reviewResult.review.approved) {
      console.log('Changes approved by reviewer');
      return {
        success: true,
        lastAttempt: { success: true, timedOut: false },
      };
    }

    // Not approved - capture feedback for next attempt
    const feedback = formatReviewFeedback(reviewResult.review.issues);
    console.log('Reviewer found issues:\n', feedback);

    lastAttempt = {
      success: false,
      timedOut: false,
      reviewerFeedback: feedback,
      error: 'Reviewer rejected the changes',
    };

    incrementTaskRetry(task.id);
  }

  // Max retries exceeded
  return {
    success: false,
    lastAttempt,
  };
}

async function handleFailedTask(
  run: Run,
  project: Project,
  task: Task,
  lastAttempt: AttemptResult
): Promise<Task | null> {
  console.log('\n--- Task Failed: Requesting Planner Recovery ---');

  // IMPROVEMENT 2: Ask planner for a simpler alternative
  const failedContext: FailedTaskContext = {
    task,
    attempts: MAX_RETRIES,
    lastError: lastAttempt.error || 'Unknown error',
    reviewerFeedback: lastAttempt.reviewerFeedback,
  };

  const recoveryResult = await runPlannerRecovery({
    runId: run.id,
    project,
    failedContext,
  });

  if (!recoveryResult.success) {
    console.error('Planner recovery failed');
    return null;
  }

  if (recoveryResult.skipTask) {
    console.log(`Planner suggests skipping task: ${recoveryResult.skipReason}`);
    addTaskComment(task.id, `Skipped: ${recoveryResult.skipReason}`);
    updateTaskStatus(task.id, 'failed');
    return null;
  }

  if (!recoveryResult.task) {
    console.error('Planner recovery did not return a valid task');
    return null;
  }

  // Mark original task as failed with comment
  addTaskComment(task.id, `Failed after ${MAX_RETRIES} attempts. Replaced with simpler task.`);
  updateTaskStatus(task.id, 'failed');

  // Create the simpler replacement task
  const newTask = createTask({
    project_id: project.id,
    title: recoveryResult.task.title,
    description: recoveryResult.task.description,
  });

  console.log(`Created simpler replacement task: ${newTask.title}`);
  updateRunTask(run.id, newTask.id);

  return newTask;
}

export async function runOrchestrator(projectId: string): Promise<OrchestratorResult> {
  console.log(`\n=== Starting Orchestrator Run ===\n`);

  // Get project
  const project = getProject(projectId);
  if (!project) {
    return {
      success: false,
      runId: '',
      taskId: null,
      commitSha: null,
      summary: `Project not found: ${projectId}`,
    };
  }

  console.log(`Project: ${project.name}`);
  console.log(`Path: ${project.path}`);

  // Create run record
  const run = createRun(project.id);
  logAgentStart(run.id, 'orchestrator', `Starting run for project ${project.name}`);

  try {
    // Get or create a task
    let task = await getOrCreateTask(run, project);

    if (!task) {
      finishRun(run.id, 'completed', 'No tasks to execute');
      return {
        success: true,
        runId: run.id,
        taskId: null,
        commitSha: null,
        summary: 'No tasks to execute',
      };
    }

    console.log(`\nExecuting task: ${task.title}`);

    // Run developer/reviewer loop
    let loopResult = await runDeveloperReviewerLoop(run, project, task);

    // IMPROVEMENT 2: If task failed, try planner recovery
    if (!loopResult.success) {
      // Reset git state before recovery attempt
      resetToLastCommit(project.path);

      const recoveryTask = await handleFailedTask(run, project, task, loopResult.lastAttempt);

      if (recoveryTask) {
        // Try the simpler task
        task = recoveryTask;
        console.log(`\nExecuting recovery task: ${task.title}`);
        loopResult = await runDeveloperReviewerLoop(run, project, task);
      }
    }

    if (!loopResult.success) {
      // Still failed after recovery attempt
      updateTaskStatus(task.id, 'failed');
      logAgentError(run.id, 'orchestrator', `Task failed after recovery attempt`);
      finishRun(run.id, 'failed', `Task failed: ${task.title}`);

      return {
        success: false,
        runId: run.id,
        taskId: task.id,
        commitSha: null,
        summary: `Task failed after ${MAX_RETRIES} attempts and recovery`,
      };
    }

    // Task succeeded - commit and push
    const status = getGitStatus(project.path);

    let commitSha: string | null = null;
    if (status.hasChanges) {
      console.log('\nCommitting changes...');
      stageAllChanges(project.path);
      commitSha = commit(project.path, `[coding-agent] ${task.title}`);
      console.log(`Committed: ${commitSha}`);

      // Push if remote exists
      if (hasRemote(project.path)) {
        console.log('Pushing to remote...');
        try {
          push(project.path);
          console.log('Pushed successfully');
        } catch (error) {
          console.warn('Failed to push:', error);
        }
      }
    }

    // Mark task as completed
    updateTaskStatus(task.id, 'completed');
    logAgentComplete(run.id, 'orchestrator', { commitSha });
    finishRun(run.id, 'completed', `Task completed: ${task.title}`, commitSha || undefined);

    return {
      success: true,
      runId: run.id,
      taskId: task.id,
      commitSha,
      summary: `Completed: ${task.title}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Orchestrator error:', errorMessage);
    logAgentError(run.id, 'orchestrator', errorMessage);
    finishRun(run.id, 'failed', errorMessage);

    return {
      success: false,
      runId: run.id,
      taskId: null,
      commitSha: null,
      summary: errorMessage,
    };
  }
}
