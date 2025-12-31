import { execSync } from 'child_process';
import { runAgent, type AgentResult } from './base-agent.js';
import type { Project } from '../db/index.js';

export interface ReviewIssue {
  severity: 'blocking' | 'warning' | 'info';
  description: string;
  file?: string;
  line?: number;
}

export interface ReviewerOutput {
  approved: boolean;
  issues: ReviewIssue[];
}

export interface ReviewerResult extends AgentResult {
  review: ReviewerOutput | null;
}

function getGitDiff(cwd: string): string {
  try {
    // Get both staged and unstaged changes
    const diff = execSync('git diff HEAD', {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    return diff || 'No changes detected';
  } catch (error) {
    // If git fails (e.g., not a git repo or no commits), return a message
    return `Unable to get git diff: ${error}`;
  }
}

function buildReviewerPrompt(gitDiff: string): string {
  return `You are a senior code reviewer. Review these code changes for issues:

\`\`\`diff
${gitDiff}
\`\`\`

[Review Criteria]
1. Security vulnerabilities (SQL injection, XSS, command injection, etc.)
2. Bugs and logic errors
3. Missing error handling
4. Performance issues
5. Code quality and maintainability

[Instructions]
- Focus on substantive issues, not style preferences
- Only mark as NOT approved if there are blocking issues
- Be specific about what needs to change

Output ONLY a JSON object (no markdown, no explanation):
{
  "approved": boolean,
  "issues": [
    {
      "severity": "blocking" | "warning" | "info",
      "description": "description of the issue",
      "file": "path/to/file.ts",
      "line": 42
    }
  ]
}

If there are no issues, output:
{
  "approved": true,
  "issues": []
}

Do not ask questions. Provide your review.`;
}

function parseReviewFromOutput(output: string): ReviewerOutput | null {
  try {
    // Try to find JSON in the output
    const jsonMatch = output.match(/\{[\s\S]*?\}/g);
    if (!jsonMatch) {
      return null;
    }

    // Try each JSON match (take the last one as it's likely the final output)
    for (let i = jsonMatch.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(jsonMatch[i]);

        if (typeof parsed.approved === 'boolean') {
          return {
            approved: parsed.approved,
            issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function runReviewer(options: {
  runId: string;
  project: Project;
}): Promise<ReviewerResult> {
  const { runId, project } = options;

  const gitDiff = getGitDiff(project.path);

  if (gitDiff === 'No changes detected') {
    return {
      success: true,
      output: 'No changes to review',
      duration: 0,
      timedOut: false,
      review: {
        approved: true,
        issues: [],
      },
    };
  }

  const prompt = buildReviewerPrompt(gitDiff);

  const result = await runAgent({
    runId,
    prompt,
    cwd: project.path,
    agentType: 'reviewer',
  });

  const review = parseReviewFromOutput(result.output);

  return {
    ...result,
    review,
  };
}

export function formatReviewFeedback(issues: ReviewIssue[]): string {
  const blockingIssues = issues.filter(i => i.severity === 'blocking');
  const warningIssues = issues.filter(i => i.severity === 'warning');

  let feedback = '';

  if (blockingIssues.length > 0) {
    feedback += 'BLOCKING ISSUES (must fix):\n';
    blockingIssues.forEach((issue, i) => {
      feedback += `${i + 1}. ${issue.description}`;
      if (issue.file) feedback += ` (${issue.file}${issue.line ? `:${issue.line}` : ''})`;
      feedback += '\n';
    });
    feedback += '\n';
  }

  if (warningIssues.length > 0) {
    feedback += 'WARNINGS (should fix):\n';
    warningIssues.forEach((issue, i) => {
      feedback += `${i + 1}. ${issue.description}`;
      if (issue.file) feedback += ` (${issue.file}${issue.line ? `:${issue.line}` : ''})`;
      feedback += '\n';
    });
  }

  return feedback;
}
