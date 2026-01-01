import { execSync } from 'child_process';
import { runAgent } from './base-agent.js';
import { createKnowledge, type Project, type Task, type KnowledgeCategory } from '../db/index.js';

interface ExtractedKnowledge {
  category: KnowledgeCategory;
  tags: string[];
  content: string;
  file_path?: string;
  importance: number;
}

function getGitDiff(cwd: string): string {
  try {
    const diff = execSync('git diff HEAD~1 HEAD --stat', {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return diff || '';
  } catch {
    return '';
  }
}

function getChangedFiles(cwd: string): string[] {
  try {
    const files = execSync('git diff HEAD~1 HEAD --name-only', {
      cwd,
      encoding: 'utf-8',
    });
    return files.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function buildExtractionPrompt(task: Task, changedFiles: string[], diffStat: string): string {
  return `You are analyzing a completed development task to extract reusable knowledge for future work.

[Completed Task]
Title: ${task.title}
Description: ${task.description}

[Changed Files]
${changedFiles.join('\n')}

[Change Summary]
${diffStat}

[Instructions]
Extract 0-3 reusable learnings from this task. Only extract knowledge that would be helpful for future similar work.

Categories:
- pattern: A code pattern or approach that worked well
- gotcha: A pitfall or issue that was discovered and solved
- decision: An architectural or design decision made
- file_note: Important information about a specific file

For each learning:
1. Keep content concise (under 100 words)
2. Make it actionable and specific
3. Include relevant tags for searchability
4. Rate importance 1-10 (10 = critical for future work)

Output ONLY a JSON array (no markdown, no explanation):
[
  {
    "category": "pattern" | "gotcha" | "decision" | "file_note",
    "tags": ["tag1", "tag2"],
    "content": "concise description of the learning",
    "file_path": "optional/path/to/file.ts",
    "importance": 5
  }
]

If nothing worth extracting, output an empty array: []

Do not include:
- Task-specific details that won't apply to other work
- Obvious or common knowledge
- Implementation details that are already in the code`;
}

function extractJsonArray(output: string): string | null {
  // Find the first '[' and match balanced brackets
  const startIndex = output.indexOf('[');
  if (startIndex === -1) return null;

  let bracketCount = 0;
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
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;

      if (bracketCount === 0) {
        return output.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function parseExtractionOutput(output: string): ExtractedKnowledge[] {
  try {
    // Find JSON array in output using balanced bracket matching
    const jsonStr = extractJsonArray(output);
    if (!jsonStr) return [];

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    // Validate and filter entries
    return parsed.filter((entry: any) => {
      const validCategories: KnowledgeCategory[] = ['pattern', 'gotcha', 'decision', 'preference', 'file_note'];
      return (
        entry &&
        typeof entry.content === 'string' &&
        entry.content.length > 0 &&
        validCategories.includes(entry.category) &&
        Array.isArray(entry.tags) &&
        typeof entry.importance === 'number'
      );
    }).map((entry: any) => ({
      category: entry.category as KnowledgeCategory,
      tags: entry.tags.filter((t: any) => typeof t === 'string'),
      content: entry.content,
      file_path: typeof entry.file_path === 'string' ? entry.file_path : undefined,
      importance: Math.min(10, Math.max(1, entry.importance)),
    }));
  } catch (error) {
    console.error('Failed to parse knowledge extraction output:', error);
    return [];
  }
}

export async function extractKnowledge(options: {
  runId: string;
  project: Project;
  task: Task;
}): Promise<{ success: boolean; extractedCount: number }> {
  const { runId, project, task } = options;

  const changedFiles = getChangedFiles(project.path);
  const diffStat = getGitDiff(project.path);

  // Skip if no changes
  if (changedFiles.length === 0) {
    return { success: true, extractedCount: 0 };
  }

  const prompt = buildExtractionPrompt(task, changedFiles, diffStat);

  try {
    const result = await runAgent({
      runId,
      prompt,
      cwd: project.path,
      agentType: 'orchestrator', // Use orchestrator type for extraction
    });

    if (!result.success) {
      return { success: false, extractedCount: 0 };
    }

    const extracted = parseExtractionOutput(result.output);

    if (extracted.length === 0) {
      console.log('No knowledge entries extracted from output');
    }

    // Save extracted knowledge to database
    for (const entry of extracted) {
      console.log(`Saving knowledge: [${entry.category}] ${entry.content.slice(0, 50)}...`);
      createKnowledge({
        project_id: project.id,
        category: entry.category,
        tags: entry.tags,
        content: entry.content,
        file_path: entry.file_path,
        importance: entry.importance,
        source_task_id: task.id,
      });
    }

    return { success: true, extractedCount: extracted.length };
  } catch (error) {
    console.error('Knowledge extraction failed:', error);
    return { success: false, extractedCount: 0 };
  }
}
