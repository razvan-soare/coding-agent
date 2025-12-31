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
  type Project,
  type Run,
  type Task,
} from './db/index.js';
import { runPlanner } from './agents/planner.js';
import { runDeveloper } from './agents/developer.js';
import { runReviewer, formatReviewFeedback } from './agents/reviewer.js';
import { getGitStatus, stageAllChanges, commit, push, hasRemote } from './git/operations.js';

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

async function developAndReview(
  run: Run,
  project: Project,
  task: Task
): Promise<{ approved: boolean; feedback: string }> {
  // Run developer
  console.log('Running developer agent...');
  const devResult = await runDeveloper({
    runId: run.id,
    project,
    task,
  });

  if (!devResult.success) {
    return {
      approved: false,
      feedback: 'Developer agent failed to complete',
    };
  }

  // Check if there are changes to review
  const status = getGitStatus(project.path);
  if (!status.hasChanges) {
    console.log('Developer made no changes');
    return {
      approved: true,
      feedback: 'No changes made',
    };
  }

  // Run reviewer
  console.log('Running reviewer agent...');
  const reviewResult = await runReviewer({
    runId: run.id,
    project,
  });

  if (!reviewResult.success || !reviewResult.review) {
    // If reviewer fails, treat as approved with warning
    console.warn('Reviewer failed, proceeding anyway');
    return {
      approved: true,
      feedback: 'Reviewer failed to complete',
    };
  }

  if (reviewResult.review.approved) {
    return {
      approved: true,
      feedback: '',
    };
  }

  // Not approved - format feedback for developer
  const feedback = formatReviewFeedback(reviewResult.review.issues);
  return {
    approved: false,
    feedback,
  };
}

async function runDeveloperReviewerLoop(
  run: Run,
  project: Project,
  task: Task
): Promise<{ success: boolean; feedback: string }> {
  let reviewerFeedback: string | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`\n--- Attempt ${attempt}/${MAX_RETRIES} ---`);

    // Update task status
    updateTaskStatus(task.id, 'in_progress');

    // Run developer (with feedback if not first attempt)
    console.log('Running developer agent...');
    const devResult = await runDeveloper({
      runId: run.id,
      project,
      task,
      reviewerFeedback,
    });

    if (!devResult.success) {
      console.error('Developer agent failed');
      incrementTaskRetry(task.id);
      continue;
    }

    // Check for changes
    const status = getGitStatus(project.path);
    if (!status.hasChanges) {
      console.log('Developer made no changes');
      return { success: true, feedback: 'No changes made' };
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
      return { success: true, feedback: 'Reviewer unavailable' };
    }

    if (reviewResult.review.approved) {
      console.log('Changes approved by reviewer');
      return { success: true, feedback: '' };
    }

    // Not approved
    reviewerFeedback = formatReviewFeedback(reviewResult.review.issues);
    console.log('Reviewer found issues:\n', reviewerFeedback);
    incrementTaskRetry(task.id);
  }

  // Max retries exceeded
  return {
    success: false,
    feedback: reviewerFeedback || 'Max retries exceeded',
  };
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
      // Mark task as failed
      updateTaskStatus(task.id, 'failed');
      logAgentError(run.id, 'orchestrator', `Task failed after ${MAX_RETRIES} attempts: ${loopResult.feedback}`);
      finishRun(run.id, 'failed', `Task failed: ${loopResult.feedback}`);

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
