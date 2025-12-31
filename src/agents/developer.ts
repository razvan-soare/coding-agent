import { runAgent, type AgentResult } from './base-agent.js';
import type { Task, Project } from '../db/index.js';

export interface DeveloperResult extends AgentResult {
  // Developer agent just implements, success is based on exit code
}

function buildDeveloperPrompt(task: Task, reviewerFeedback?: string): string {
  let prompt = `You are a software developer implementing a feature. Here is your task:

Title: ${task.title}

Description:
${task.description}

[Instructions]
1. Implement this task completely
2. Write clean, well-structured code
3. Follow existing code patterns in the project
4. Do NOT commit changes - the orchestrator will handle git operations
5. Make reasonable assumptions if anything is unclear

Do not ask clarifying questions. Just implement the task.`;

  if (reviewerFeedback) {
    prompt += `

[IMPORTANT: Reviewer Feedback]
The previous implementation had issues that need to be fixed:

${reviewerFeedback}

Address ALL the issues mentioned above in your implementation.`;
  }

  return prompt;
}

export async function runDeveloper(options: {
  runId: string;
  project: Project;
  task: Task;
  reviewerFeedback?: string;
}): Promise<DeveloperResult> {
  const { runId, project, task, reviewerFeedback } = options;

  const prompt = buildDeveloperPrompt(task, reviewerFeedback);

  const result = await runAgent({
    runId,
    prompt,
    cwd: project.path,
    agentType: 'developer',
  });

  return result;
}
