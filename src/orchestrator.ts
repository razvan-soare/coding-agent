import {
  createRun,
  createTask,
  createTasksForMilestone,
  finishRun,
  getNextPendingTask,
  getProject,
  getTask,
  getTasksByMilestone,
  incrementTaskRetry,
  logAgentError,
  logAgentStart,
  logAgentComplete,
  updateRunTask,
  updateTaskStatus,
  addTaskComment,
  getCurrentMilestone,
  getNextMilestone,
  getNextPendingMilestone,
  updateMilestoneStatus,
  updateProject,
  hasPendingMilestoneTasks,
  getMilestoneTaskStats,
  type Project,
  type Run,
  type Task,
  type TriggerSource,
} from './db/index.js';
import { runPlanner, runPlannerRecovery, runMilestonePlanner, type FailedTaskContext } from './agents/planner.js';
import { runDeveloper, type RetryContext } from './agents/developer.js';
import { runReviewer, formatReviewFeedback } from './agents/reviewer.js';
import { extractKnowledge } from './agents/knowledge-extractor.js';
import { getGitStatus, stageAllChanges, commit, push, hasRemote, resetToLastCommit, type GitAuthor } from './git/operations.js';

const MAX_RETRIES = 3;

export interface OrchestratorResult {
  success: boolean;
  runId: string;
  taskId: string | null;
  commitSha: string | null;
  summary: string;
}

/**
 * Break down a milestone into tasks using the milestone planner.
 * Returns the created tasks or null if planning failed.
 */
async function planMilestoneTasks(
  run: Run,
  project: Project,
  milestoneId: string
): Promise<Task[] | null> {
  const milestone = getCurrentMilestone(project.id);
  if (!milestone || milestone.id !== milestoneId) {
    console.error('Milestone not found or mismatch');
    return null;
  }

  console.log(`\n📋 Breaking down milestone: ${milestone.title}`);

  const plannerResult = await runMilestonePlanner({
    runId: run.id,
    project,
    milestone,
  });

  if (!plannerResult.success) {
    console.error('Milestone planner failed:', plannerResult.output.slice(0, 200));
    return null;
  }

  if (plannerResult.tasks.length === 0) {
    console.error('Milestone planner did not return any tasks');
    return null;
  }

  // Create all tasks for the milestone
  const tasks = createTasksForMilestone({
    project_id: project.id,
    milestone_id: milestoneId,
    tasks: plannerResult.tasks,
  });

  console.log(`✅ Created ${tasks.length} tasks for milestone:`);
  tasks.forEach((t, i) => console.log(`   ${i + 1}. ${t.title}`));

  return tasks;
}

/**
 * Check if milestone is complete and advance to next one if needed.
 * Returns the next milestone ID or null if all milestones are done.
 */
function checkAndAdvanceMilestone(project: Project): string | null {
  const currentMilestone = getCurrentMilestone(project.id);

  if (!currentMilestone) {
    // No current milestone - try to get the next pending one
    const nextMilestone = getNextPendingMilestone(project.id);
    if (nextMilestone) {
      console.log(`📋 Starting milestone: ${nextMilestone.title}`);
      updateProject(project.id, { current_milestone_id: nextMilestone.id });
      updateMilestoneStatus(nextMilestone.id, 'in_progress');
      return nextMilestone.id;
    }
    return null;
  }

  // Check if current milestone has pending tasks
  if (hasPendingMilestoneTasks(currentMilestone.id)) {
    // Still has work to do
    return currentMilestone.id;
  }

  // No pending tasks - check if milestone is complete
  const stats = getMilestoneTaskStats(currentMilestone.id);

  if (stats.total === 0) {
    // Milestone has no tasks yet - needs planning
    return currentMilestone.id;
  }

  // Milestone has tasks but none are pending - it's complete (or all failed)
  if (stats.completed > 0 || stats.failed === stats.total) {
    console.log(`✅ Milestone complete: ${currentMilestone.title}`);
    console.log(`   Stats: ${stats.completed} completed, ${stats.failed} failed`);
    updateMilestoneStatus(currentMilestone.id, 'completed');

    // Advance to next milestone
    const nextMilestone = getNextMilestone(project.id, currentMilestone.order_index);

    if (nextMilestone) {
      console.log(`📋 Advancing to milestone: ${nextMilestone.title}`);
      updateProject(project.id, { current_milestone_id: nextMilestone.id });
      updateMilestoneStatus(nextMilestone.id, 'in_progress');
      return nextMilestone.id;
    }

    console.log('🎉 All milestones complete! Project finished.');
    updateProject(project.id, { current_milestone_id: null });
    return null;
  }

  return currentMilestone.id;
}

async function getOrCreateTask(run: Run, project: Project): Promise<Task | null> {
  // Check and potentially advance to next milestone
  const milestoneId = checkAndAdvanceMilestone(project);

  // Check for pending tasks (respecting milestone ordering)
  let task = getNextPendingTask(project.id, milestoneId ?? undefined);

  if (task) {
    updateRunTask(run.id, task.id);
    return task;
  }

  // No pending tasks - if we have a milestone, it might need planning
  if (milestoneId) {
    const milestoneTasks = getTasksByMilestone(milestoneId);

    if (milestoneTasks.length === 0) {
      // Milestone has no tasks - run the milestone planner to break it down
      const tasks = await planMilestoneTasks(run, project, milestoneId);

      if (tasks && tasks.length > 0) {
        // Return the first task
        updateRunTask(run.id, tasks[0].id);
        return tasks[0];
      }

      // Planning failed - fall back to regular planner for a single task
      console.log('Milestone planning failed, falling back to single-task planner...');
    }
  }

  // Fall back to regular planner (for cases without milestones or fallback)
  console.log('Running planner for next task...');

  const plannerResult = await runPlanner({
    runId: run.id,
    project,
  });

  if (!plannerResult.success) {
    console.error('Planner failed:', plannerResult.output.slice(0, 200));
    return null;
  }

  // If planner says milestone is complete but we have no tasks, something is wrong
  if (plannerResult.milestoneComplete) {
    console.log('Planner indicates milestone complete - checking next milestone');
    // This shouldn't happen with the new flow, but handle it gracefully
    const newMilestoneId = checkAndAdvanceMilestone(project);
    if (newMilestoneId && newMilestoneId !== milestoneId) {
      // Recursively try to get a task for the new milestone
      return getOrCreateTask(run, project);
    }
    return null;
  }

  if (!plannerResult.task) {
    console.error('Planner did not return a valid task');
    return null;
  }

  // Create a single task
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

      // Build commit message and author info
      const hasCustomAuthor = project.git_author_name && project.git_author_email;
      const commitMessage = hasCustomAuthor
        ? task.title  // Clean commit message without [coding-agent] prefix
        : `[coding-agent] ${task.title}`;
      const author: GitAuthor | undefined = hasCustomAuthor
        ? { name: project.git_author_name!, email: project.git_author_email! }
        : undefined;

      commitSha = commit(project.path, commitMessage, author);
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
