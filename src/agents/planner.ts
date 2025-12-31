import { readFileSync } from 'fs';
import { runAgent, type AgentResult } from './base-agent.js';
import { getCompletedTasks, getCurrentMilestone, type Project, type Milestone, type Task } from '../db/index.js';

export interface PlannerOutput {
  title: string;
  description: string;
}

export interface PlannerResult extends AgentResult {
  task: PlannerOutput | null;
  milestoneComplete: boolean;
}

function buildPlannerPrompt(
  overviewContent: string,
  milestone: Milestone | null,
  completedTasks: Task[]
): string {
  const completedTasksList = completedTasks.length > 0
    ? completedTasks.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
    : 'None yet';

  const milestoneSection = milestone
    ? `[Current Milestone]\n${milestone.title}: ${milestone.description || 'No description'}`
    : '[Current Milestone]\nNo specific milestone set - work on core features';

  return `You are a technical project planner. Given the project overview and completed work, generate the next task that needs implementation.

${overviewContent}

${milestoneSection}

[Completed Tasks]
${completedTasksList}

[Instructions]
1. Analyze what has been built so far
2. Determine the next logical task to implement
3. Generate ONE task with detailed instructions

Output ONLY a JSON object (no markdown, no explanation):
{
  "title": "short descriptive title",
  "description": "detailed implementation instructions that a junior developer can follow. Include specific file paths, function names, and step-by-step guidance."
}

If the current milestone is complete, output:
{
  "milestone_complete": true
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

  // Get current milestone and completed tasks
  const milestone = getCurrentMilestone(project.id);
  const completedTasks = getCompletedTasks(project.id);

  const prompt = buildPlannerPrompt(overviewContent, milestone, completedTasks);

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
