import { runAgent, type AgentResult } from './base-agent.js';
import { getRelevantKnowledge, formatKnowledgeForPrompt, markKnowledgeUsed, type Task, type Project } from '../db/index.js';
import { detectWebReferences, generateWebExtractionPrompt } from '../utils/url-detector.js';

export interface DeveloperResult extends AgentResult {
  // Developer agent just implements, success is based on exit code
}

export interface RetryContext {
  attemptNumber: number;
  maxAttempts: number;
  previousError?: string;
  timedOut?: boolean;
  reviewerFeedback?: string;
}

function buildDeveloperPrompt(task: Task, knowledgeContext: string, webExtractionPrompt: string, retryContext?: RetryContext): string {
  const knowledgeSection = knowledgeContext
    ? `
[Project Knowledge]
Keep these patterns and gotchas in mind while implementing:
${knowledgeContext}
`
    : '';

  const webSection = webExtractionPrompt
    ? `
${webExtractionPrompt}
`
    : '';

  let prompt = `You are a software developer implementing a feature. Here is your task:

Title: ${task.title}

Description:
${task.description}
${knowledgeSection}${webSection}[Instructions]
1. Implement this task completely
2. Write clean, well-structured code
3. Follow existing code patterns in the project
4. Do NOT commit changes - the orchestrator will handle git operations
5. Make reasonable assumptions if anything is unclear

Do not ask clarifying questions. Just implement the task.`;

  if (retryContext && retryContext.attemptNumber > 1) {
    prompt += `

[IMPORTANT: Retry Attempt ${retryContext.attemptNumber}/${retryContext.maxAttempts}]
The previous attempt failed. Here's what went wrong:`;

    if (retryContext.timedOut) {
      prompt += `
- The previous attempt TIMED OUT due to inactivity
- This usually means the process got stuck or was waiting for input
- Try a different approach or break down the work into smaller steps
- Make sure to produce output regularly so we know you're making progress`;
    }

    if (retryContext.previousError) {
      prompt += `
- Error from previous attempt: ${retryContext.previousError}`;
    }

    if (retryContext.reviewerFeedback) {
      prompt += `

[Reviewer Feedback]
The reviewer found these issues that need to be fixed:

${retryContext.reviewerFeedback}

Address ALL the issues mentioned above.`;
    }

    prompt += `

Learn from these issues and try a different approach if needed.`;
  }

  return prompt;
}

export async function runDeveloper(options: {
  runId: string;
  project: Project;
  task: Task;
  retryContext?: RetryContext;
}): Promise<DeveloperResult> {
  const { runId, project, task, retryContext } = options;

  // Get relevant knowledge for this task (only if enabled)
  let knowledgeContext = '';
  if (project.use_knowledge) {
    // Extract keywords from task for knowledge retrieval
    const taskKeywords = task.title.toLowerCase().split(/\s+/).concat(
      task.description.toLowerCase().split(/\s+/).slice(0, 20)
    );

    const relevantKnowledge = getRelevantKnowledge(project.id, {
      keywords: taskKeywords,
      categories: ['pattern', 'gotcha', 'file_note'],
      limit: 8,
    });

    // Mark knowledge as used (for tracking and decay)
    for (const k of relevantKnowledge) {
      markKnowledgeUsed(k.id);
    }

    knowledgeContext = formatKnowledgeForPrompt(relevantKnowledge);
  }

  // Detect web references in task description for extraction tasks
  const webReferences = detectWebReferences(`${task.title} ${task.description}`);
  const webExtractionPrompt = webReferences.length > 0
    ? generateWebExtractionPrompt(webReferences)
    : '';

  if (webReferences.length > 0) {
    console.log(`[Developer] Detected ${webReferences.length} web reference(s) - enabling extraction tools`);
  }

  const prompt = buildDeveloperPrompt(task, knowledgeContext, webExtractionPrompt, retryContext);

  const result = await runAgent({
    runId,
    prompt,
    cwd: project.path,
    agentType: 'developer',
  });

  return result;
}
