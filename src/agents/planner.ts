import { readFileSync } from 'fs';
import { runAgent, type AgentResult } from './base-agent.js';
import { getCompletedTasks, getFailedTasks, getCurrentMilestone, getNextPendingMilestone, updateMilestoneStatus, updateProject, getEssentialKnowledge, getRelevantKnowledge, formatKnowledgeForPrompt, type Project, type Milestone, type Task } from '../db/index.js';

export interface PlannerOutput {
  title: string;
  description: string;
}

export interface MilestonePlannerOutput {
  tasks: PlannerOutput[];
}

export interface PlannerResult extends AgentResult {
  task: PlannerOutput | null;
  milestoneComplete: boolean;
}

function formatFailedTask(task: Task, index: number): string {
  let result = `${index + 1}. [FAILED] ${task.title}`;

  // Parse and include failure comments
  if (task.comments) {
    try {
      const comments = JSON.parse(task.comments) as string[];
      if (comments.length > 0) {
        result += `\n   Failure notes: ${comments.join('; ')}`;
      }
    } catch {
      // Ignore parse errors
    }
  }

  if (task.retry_count > 0) {
    result += `\n   Attempts: ${task.retry_count}`;
  }

  return result;
}

function buildRepositoryContext(project: Project): string {
  if (!project.import_mode) {
    return '';
  }

  if (project.import_mode === 'in_place') {
    return `[Repository Context]
This is an IMPORTED repository being worked on IN PLACE.
Original Repository: ${project.repository_url || project.path}

IMPORTANT: You are working with an EXISTING codebase. Before suggesting tasks:
- Explore the existing file structure to understand what's already there
- Respect existing patterns, naming conventions, and architecture
- Tasks should build upon existing work, not rewrite from scratch
- Be cautious with breaking changes to existing functionality
- Consider backward compatibility when making changes

`;
  } else if (project.import_mode === 'reference' && project.reference_path) {
    return `[Repository Context]
This is a NEW project with a REFERENCE repository available.
Reference Repository: ${project.reference_path}
Original Source: ${project.repository_url || project.reference_path}

IMPORTANT: You have READ access to a reference codebase at the path above.
- The developer can read files from the reference to understand patterns
- Suggest exploring specific reference files when relevant
- Adapt patterns from the reference - don't copy blindly
- This is a NEW project, so build fresh but informed by the reference

`;
  }

  return '';
}

function buildPlannerPrompt(
  overviewContent: string,
  milestone: Milestone | null,
  completedTasks: Task[],
  failedTasks: Task[],
  knowledgeContext: string,
  project: Project
): string {
  const completedTasksList = completedTasks.length > 0
    ? completedTasks.map((t, i) => `${i + 1}. [DONE] ${t.title}`).join('\n')
    : 'None yet';

  const failedTasksList = failedTasks.length > 0
    ? failedTasks.map((t, i) => formatFailedTask(t, i)).join('\n')
    : '';

  const taskHistory = failedTasksList
    ? `${completedTasksList}\n\n[Failed Tasks - Need Different Approach]\n${failedTasksList}`
    : completedTasksList;

  const milestoneSection = milestone
    ? `[Current Milestone]
Title: ${milestone.title}
Requirements:
${milestone.description || 'No specific requirements listed'}

IMPORTANT: The milestone is ONLY complete when ALL requirements listed above have been implemented and verified through completed tasks. Failed tasks do NOT count as completed.`
    : '[Current Milestone]\nNo specific milestone set - work on core features';

  const knowledgeSection = knowledgeContext
    ? `[Project Knowledge]\nThese are important patterns, decisions, and gotchas for this project:\n${knowledgeContext}\n`
    : '';

  const repositoryContext = buildRepositoryContext(project);

  return `You are a technical project planner. Given the project overview and completed work, generate the next task that needs implementation.

${repositoryContext}${overviewContent}

${milestoneSection}

[Task History]
${taskHistory}

${knowledgeSection}[Instructions]
1. Review the current milestone requirements carefully
2. Compare each requirement against the completed tasks
3. If ANY requirement is not covered by a completed task, generate a task for it
4. For failed tasks: READ THE FAILURE NOTES and create a NEW task with a DIFFERENT approach
   - Do NOT repeat the same task title or description
   - Simplify the scope or break it into smaller pieces
   - Try alternative tools, libraries, or methods
   - Address the specific issues mentioned in failure notes

CRITICAL MILESTONE RULES:
- A milestone is ONLY complete when EVERY requirement in the milestone description has a corresponding COMPLETED task
- Failed tasks do NOT satisfy requirements - they need to be retried
- If any requirement is missing or only has a failed task, the milestone is NOT complete
- When in doubt, generate another task - it's better to over-deliver than under-deliver

IMPORTANT: Focus on WHAT needs to be done, not HOW to implement it:
- Describe the feature, behavior, or outcome expected
- Mention any specific requirements (responsive design, accessibility, etc.)
- You may suggest UI/UX considerations (icons, colors, layout preferences)
- Do NOT include code snippets, import statements, or implementation details
- Do NOT specify exact function names, file paths, or technical architecture
- Let the developer decide the implementation approach

Good example: "Add a dark mode toggle to the settings page. The toggle should persist user preference and apply theme changes immediately."

Bad example: "Create a ThemeContext using React.createContext. Import { useState, useEffect } from 'react'..."

Output ONLY a JSON object (no markdown, no explanation):
{
  "title": "short descriptive title",
  "description": "Clear description of WHAT should be built, the expected behavior, and any specific requirements. No code."
}

ONLY if you have verified that EVERY requirement in the milestone is satisfied by a completed task, output:
{
  "milestone_complete": true,
  "verification": ["requirement 1 - satisfied by task X", "requirement 2 - satisfied by task Y", ...]
}

Do not ask questions. Make reasonable assumptions based on the project overview.`;
}

function extractJsonFromOutput(output: string): string | null {
  // First, try to extract from markdown code blocks
  const codeBlockMatch = output.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }

  // Try to find a JSON object by matching balanced braces
  const startIndex = output.indexOf('{');
  if (startIndex === -1) return null;

  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < output.length; i++) {
    const char = output[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;

      if (braceCount === 0) {
        return output.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function parseTaskFromOutput(output: string): { task: PlannerOutput | null; milestoneComplete: boolean } {
  try {
    const jsonStr = extractJsonFromOutput(output);
    if (!jsonStr) {
      return { task: null, milestoneComplete: false };
    }

    const parsed = JSON.parse(jsonStr);

    if (parsed.milestone_complete === true) {
      return { task: null, milestoneComplete: true };
    }

    if (parsed.title && parsed.description) {
      return {
        task: {
          title: parsed.title,
          description: parsed.description,
        },
        milestoneComplete: false,
      };
    }

    return { task: null, milestoneComplete: false };
  } catch {
    return { task: null, milestoneComplete: false };
  }
}

export async function runPlanner(options: {
  runId: string;
  project: Project;
}): Promise<PlannerResult> {
  const { runId, project } = options;

  // Read project overview
  let overviewContent: string;
  try {
    overviewContent = readFileSync(project.overview_path, 'utf-8');
  } catch (error) {
    return {
      success: false,
      output: `Failed to read project overview: ${error}`,
      duration: 0,
      timedOut: false,
      task: null,
      milestoneComplete: false,
    };
  }

  // Get current milestone - fallback to next pending milestone if none set
  let milestone = getCurrentMilestone(project.id);

  if (!milestone) {
    // No current milestone set - find the next pending one
    milestone = getNextPendingMilestone(project.id);

    if (milestone) {
      // Auto-set this as the current milestone
      console.log(`[Planner] Auto-selecting milestone: ${milestone.title}`);
      updateProject(project.id, { current_milestone_id: milestone.id });
      updateMilestoneStatus(milestone.id, 'in_progress');
    }
  }

  // Get tasks only for the current milestone (keeps prompt short)
  const milestoneId = milestone?.id;
  const completedTasks = getCompletedTasks(project.id, milestoneId);
  const failedTasks = getFailedTasks(project.id, milestoneId);

  // Get relevant knowledge for planning (only if enabled)
  let knowledgeContext = '';
  if (project.use_knowledge) {
    const essentialKnowledge = getEssentialKnowledge(project.id, 5);
    const relevantKnowledge = getRelevantKnowledge(project.id, {
      categories: ['decision', 'preference', 'gotcha'],
      limit: 5,
    });

    // Combine and dedupe knowledge
    const allKnowledge = [...essentialKnowledge];
    for (const k of relevantKnowledge) {
      if (!allKnowledge.some(e => e.id === k.id)) {
        allKnowledge.push(k);
      }
    }
    knowledgeContext = formatKnowledgeForPrompt(allKnowledge.slice(0, 8));
  }

  const prompt = buildPlannerPrompt(overviewContent, milestone, completedTasks, failedTasks, knowledgeContext, project);

  const result = await runAgent({
    runId,
    prompt,
    cwd: project.path,
    agentType: 'planner',
  });

  const { task, milestoneComplete } = parseTaskFromOutput(result.output);

  return {
    ...result,
    task,
    milestoneComplete,
  };
}

export interface FailedTaskContext {
  task: Task;
  attempts: number;
  lastError: string;
  reviewerFeedback?: string;
}

function buildRecoveryPrompt(
  overviewContent: string,
  failedContext: FailedTaskContext
): string {
  return `You are a technical project planner. A task has failed after ${failedContext.attempts} attempts and needs to be broken down into simpler subtasks.

[Project Overview]
${overviewContent}

[Failed Task]
Title: ${failedContext.task.title}
Description: ${failedContext.task.description}

[What Went Wrong]
${failedContext.lastError}
${failedContext.reviewerFeedback ? `\nReviewer feedback: ${failedContext.reviewerFeedback}` : ''}

[Instructions]
The original task was too complex or had issues. Generate a SIMPLER, more focused task that:
1. Addresses a smaller piece of the original goal
2. Avoids the issues that caused the failure
3. Can be completed in a single session

IMPORTANT: Focus on WHAT needs to be done, not HOW to implement it:
- Describe the feature, behavior, or outcome expected
- Do NOT include code snippets, import statements, or implementation details
- Let the developer decide the implementation approach

Output ONLY a JSON object (no markdown, no explanation):
{
  "title": "short descriptive title for the simpler task",
  "description": "Clear description of WHAT should be built. No code."
}

If the task fundamentally cannot be done (e.g., missing dependencies, wrong approach), output:
{
  "skip_task": true,
  "reason": "explanation of why this task should be skipped"
}

Do not ask questions. Propose a concrete simpler alternative.`;
}

export interface RecoveryResult extends AgentResult {
  task: PlannerOutput | null;
  skipTask: boolean;
  skipReason?: string;
}

export async function runPlannerRecovery(options: {
  runId: string;
  project: Project;
  failedContext: FailedTaskContext;
}): Promise<RecoveryResult> {
  const { runId, project, failedContext } = options;

  // Read project overview
  let overviewContent: string;
  try {
    overviewContent = readFileSync(project.overview_path, 'utf-8');
  } catch (error) {
    return {
      success: false,
      output: `Failed to read project overview: ${error}`,
      duration: 0,
      timedOut: false,
      task: null,
      skipTask: false,
    };
  }

  const prompt = buildRecoveryPrompt(overviewContent, failedContext);

  const result = await runAgent({
    runId,
    prompt,
    cwd: project.path,
    agentType: 'planner',
  });

  // Parse the output
  const jsonStr = extractJsonFromOutput(result.output);
  if (!jsonStr) {
    return {
      ...result,
      task: null,
      skipTask: false,
    };
  }

  try {
    const parsed = JSON.parse(jsonStr);

    if (parsed.skip_task === true) {
      return {
        ...result,
        task: null,
        skipTask: true,
        skipReason: parsed.reason,
      };
    }

    if (parsed.title && parsed.description) {
      return {
        ...result,
        task: {
          title: parsed.title,
          description: parsed.description,
        },
        skipTask: false,
      };
    }

    return {
      ...result,
      task: null,
      skipTask: false,
    };
  } catch {
    return {
      ...result,
      task: null,
      skipTask: false,
    };
  }
}

// ============================================
// Milestone Breakdown Planner
// ============================================

function buildMilestonePlannerPrompt(
  overviewContent: string,
  milestone: Milestone,
  knowledgeContext: string
): string {
  const knowledgeSection = knowledgeContext
    ? `[Project Knowledge]\nThese are important patterns, decisions, and gotchas for this project:\n${knowledgeContext}\n`
    : '';

  return `You are a technical project planner. Your job is to break down a milestone into detailed, actionable tasks that a developer can execute one by one.

${overviewContent}

[Milestone to Break Down]
Title: ${milestone.title}
Description:
${milestone.description || 'No specific description provided'}

${knowledgeSection}[Instructions]
Break down this milestone into a sequence of detailed tasks. Each task should:

1. Be SPECIFIC and ACTIONABLE - a developer should be able to pick up a task and start working immediately
2. Be SELF-CONTAINED - each task should produce a working, testable increment
3. Include ACCEPTANCE CRITERIA - describe what "done" looks like
4. Be ORDERED LOGICALLY - dependencies should come first
5. Be DETAILED ENOUGH for easy implementation but focused on WHAT, not HOW

IMPORTANT GUIDELINES:
- Create 3-10 tasks depending on milestone complexity
- Each task should be completable in a single development session
- Tasks should build on each other - earlier tasks create foundation for later ones
- Include setup tasks if needed (dependencies, configuration, etc.)
- Include tasks for testing/verification where appropriate
- Focus on WHAT needs to be done, not HOW to implement it
- Do NOT include code snippets or implementation details

TASK FORMAT:
Each task should have:
- title: A short, descriptive title (5-10 words)
- description: A clear description including:
  - What feature/behavior to implement
  - What the expected outcome should be
  - Any specific requirements (UI, accessibility, etc.)
  - How to verify the task is complete

Output ONLY a JSON object (no markdown, no explanation):
{
  "tasks": [
    {
      "title": "First task title",
      "description": "Detailed description of what to build and how to verify it's complete"
    },
    {
      "title": "Second task title",
      "description": "Detailed description..."
    }
  ]
}

Make the tasks detailed enough that if something goes wrong, we can easily identify which task failed and backtrack.`;
}

function parseTasksFromOutput(output: string): PlannerOutput[] {
  try {
    const jsonStr = extractJsonFromOutput(output);
    if (!jsonStr) {
      return [];
    }

    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed.tasks)) {
      return parsed.tasks
        .filter((t: unknown) => {
          const task = t as Record<string, unknown>;
          return task && typeof task.title === 'string' && typeof task.description === 'string';
        })
        .map((t: unknown) => {
          const task = t as Record<string, string>;
          return {
            title: task.title,
            description: task.description,
          };
        });
    }

    return [];
  } catch {
    return [];
  }
}

export interface MilestonePlannerResult extends AgentResult {
  tasks: PlannerOutput[];
}

export async function runMilestonePlanner(options: {
  runId: string;
  project: Project;
  milestone: Milestone;
}): Promise<MilestonePlannerResult> {
  const { runId, project, milestone } = options;

  // Read project overview
  let overviewContent: string;
  try {
    overviewContent = readFileSync(project.overview_path, 'utf-8');
  } catch (error) {
    return {
      success: false,
      output: `Failed to read project overview: ${error}`,
      duration: 0,
      timedOut: false,
      tasks: [],
    };
  }

  // Get relevant knowledge for planning (only if enabled)
  let knowledgeContext = '';
  if (project.use_knowledge) {
    const essentialKnowledge = getEssentialKnowledge(project.id, 5);
    const relevantKnowledge = getRelevantKnowledge(project.id, {
      categories: ['decision', 'preference', 'gotcha'],
      limit: 5,
    });

    // Combine and dedupe knowledge
    const allKnowledge = [...essentialKnowledge];
    for (const k of relevantKnowledge) {
      if (!allKnowledge.some(e => e.id === k.id)) {
        allKnowledge.push(k);
      }
    }
    knowledgeContext = formatKnowledgeForPrompt(allKnowledge.slice(0, 8));
  }

  const prompt = buildMilestonePlannerPrompt(overviewContent, milestone, knowledgeContext);

  console.log(`[MilestonePlanner] Breaking down milestone: ${milestone.title}`);

  const result = await runAgent({
    runId,
    prompt,
    cwd: project.path,
    agentType: 'planner',
  });

  const tasks = parseTasksFromOutput(result.output);

  if (tasks.length === 0) {
    console.warn('[MilestonePlanner] No tasks extracted from output');
  } else {
    console.log(`[MilestonePlanner] Generated ${tasks.length} tasks for milestone`);
  }

  return {
    ...result,
    tasks,
  };
}
