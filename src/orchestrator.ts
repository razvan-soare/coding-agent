import {
  createRun,
  createTask,
  finishRun,
  getNextPendingTask,
  getProject,
  getTask,
  incrementTaskRetry,
  logAgentError,
  logAgentStart,
  logAgentComplete,
  updateRunTask,
  updateTaskStatus,
  addTaskComment,
  getCurrentMilestone,
  getNextMilestone,
  updateMilestoneStatus,
  updateProject,
  type Project,
  type Run,
  type Task,
  type TriggerSource,
} from './db/index.js';
import { runPlanner, runPlannerRecovery, type FailedTaskContext } from './agents/planner.js';
import { runDeveloper, type RetryContext } from './agents/developer.js';
import { runReviewer, formatReviewFeedback } from './agents/reviewer.js';
import { extractKnowledge } from './agents/knowledge-extractor.js';
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
    // Milestone is complete - advance to next milestone
    const currentMilestone = getCurrentMilestone(project.id);

    if (currentMilestone) {
      console.log(`✅ Milestone complete: ${currentMilestone.title}`);
      updateMilestoneStatus(currentMilestone.id, 'completed');

      // Get next milestone
      const nextMilestone = getNextMilestone(project.id, currentMilestone.order_index);

      if (nextMilestone) {
        console.log(`📋 Advancing to next milestone: ${nextMilestone.title}`);
        updateProject(project.id, { current_milestone_id: nextMilestone.id });
        updateMilestoneStatus(nextMilestone.id, 'in_progress');

        // Run planner again for the new milestone
        const nextPlannerResult = await runPlanner({
          runId: run.id,
          project: { ...project, current_milestone_id: nextMilestone.id },
        });

        if (nextPlannerResult.success && nextPlannerResult.task) {
          task = createTask({
            project_id: project.id,
            milestone_id: nextMilestone.id,
            title: nextPlannerResult.task.title,
            description: nextPlannerResult.task.description,
          });

          console.log(`Created task: ${task.title}`);
          updateRunTask(run.id, task.id);
          return task;
        }
      } else {
        console.log('🎉 All milestones complete! Project finished.');
        return null;
      }
    }

    return null;
  }

  if (!plannerResult.task) {
    console.error('Planner did not return a valid task');
    return null;
  }

  // Create the new task
  const currentMilestone = getCurrentMilestone(project.id);
  task = createTask({
    project_id: project.id,
    milestone_id: currentMilestone?.id,
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

    // Update task status
    updateTaskStatus(task.id, 'in_progress');

    // Build retry context with error information (for attempts > 1)
    // NO git reset between attempts - let developer improve on existing work
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
): Promise<{ recoveryTaskCreated: boolean; recoveryTaskId?: string }> {
  console.log('\n--- Task Failed: Requesting Planner Recovery ---');

  // Reset git state before asking planner for recovery
  console.log('Resetting git state to last commit...');
  resetToLastCommit(project.path);

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
    return { recoveryTaskCreated: false };
  }

  if (recoveryResult.skipTask) {
    console.log(`Planner suggests skipping task: ${recoveryResult.skipReason}`);
    addTaskComment(task.id, `Skipped: ${recoveryResult.skipReason}`);
    updateTaskStatus(task.id, 'failed');
    return { recoveryTaskCreated: false };
  }

  if (!recoveryResult.task) {
    console.error('Planner recovery did not return a valid task');
    return { recoveryTaskCreated: false };
  }

  // Mark original task as failed with comment
  addTaskComment(task.id, `Failed after ${MAX_RETRIES} attempts. Recovery task created.`);
  updateTaskStatus(task.id, 'failed');

  // Create the simpler replacement task as PENDING (don't run it in this session)
  const newTask = createTask({
    project_id: project.id,
    title: recoveryResult.task.title,
    description: recoveryResult.task.description,
  });

  console.log(`Created recovery task: ${newTask.title}`);
  console.log('Recovery task will be executed in the next run (preventing infinite loops)');

  return { recoveryTaskCreated: true, recoveryTaskId: newTask.id };
}

function isRecoveryTask(task: Task): boolean {
  // Check if this task was created as a recovery for a previously failed task
  // We can detect this by checking if there's a failed task with a comment mentioning recovery
  // For simplicity, we'll track this via the task description containing recovery markers
  // OR we could add a field to the task table - but for now, we'll just limit runs

  // Simple approach: check retry count - if task itself has failed 3 times, don't recover again
  return task.retry_count >= MAX_RETRIES;
}

export async function runOrchestrator(projectId: string, triggerSource: TriggerSource = 'cli'): Promise<OrchestratorResult> {
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
  console.log(`Trigger: ${triggerSource}`);

  // Create run record with trigger source
  const run = createRun(project.id, undefined, triggerSource);
  logAgentStart(run.id, 'orchestrator', `Starting run for project ${project.name} (${triggerSource})`);

  try {
    // Get or create a task
    const task = await getOrCreateTask(run, project);

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
    const loopResult = await runDeveloperReviewerLoop(run, project, task);

    if (!loopResult.success) {
      // Task failed after 3 attempts
      // Only attempt recovery if this isn't already a recovery task
      const currentTask = getTask(task.id);

      if (currentTask && currentTask.retry_count >= MAX_RETRIES) {
        // This task has been retried 3 times - request planner recovery
        // but DON'T run the recovery task in this session (prevents infinite loop)
        const recovery = await handleFailedTask(run, project, task, loopResult.lastAttempt);

        if (recovery.recoveryTaskCreated) {
          finishRun(run.id, 'failed', `Task failed. Recovery task created for next run.`);
          return {
            success: false,
            runId: run.id,
            taskId: task.id,
            commitSha: null,
            summary: `Task failed after ${MAX_RETRIES} attempts. Recovery task queued.`,
          };
        }
      }

      // No recovery possible or recovery task wasn't created
      updateTaskStatus(task.id, 'failed');
      logAgentError(run.id, 'orchestrator', `Task failed after ${MAX_RETRIES} attempts`);
      finishRun(run.id, 'failed', `Task failed: ${task.title}`);

      return {
        success: false,
        runId: run.id,
        taskId: task.id,
        commitSha: null,
        summary: `Task failed after ${MAX_RETRIES} attempts`,
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

    // Extract knowledge from completed task (non-blocking)
    console.log('\nExtracting knowledge from completed task...');
    try {
      const extractionResult = await extractKnowledge({
        runId: run.id,
        project,
        task,
      });
      if (extractionResult.extractedCount > 0) {
        console.log(`Extracted ${extractionResult.extractedCount} knowledge entries`);
      }
    } catch (error) {
      // Knowledge extraction is optional, don't fail the run
      console.warn('Knowledge extraction failed:', error);
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
