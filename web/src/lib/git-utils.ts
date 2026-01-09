import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface ValidationResult {
  valid: boolean;
  type: 'github' | 'local' | null;
  error?: string;
}

/**
 * Check if a string is a GitHub URL
 */
export function isGitHubUrl(source: string): boolean {
  return /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/.test(source);
}

/**
 * Check if a path is a local git repository
 */
export function isLocalGitRepo(path: string): boolean {
  if (!existsSync(path)) return false;
  return existsSync(join(path, '.git'));
}

/**
 * Check if a path exists on the filesystem
 */
export function pathExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Validate a repository source (GitHub URL or local path)
 */
export function validateRepositorySource(source: string): ValidationResult {
  if (!source || !source.trim()) {
    return {
      valid: false,
      type: null,
      error: 'Repository source is required',
    };
  }

  const trimmedSource = source.trim();

  // Check if GitHub URL
  if (isGitHubUrl(trimmedSource)) {
    return { valid: true, type: 'github' };
  }

  // Check if local path
  if (existsSync(trimmedSource)) {
    if (isLocalGitRepo(trimmedSource)) {
      return { valid: true, type: 'local' };
    }
    return {
      valid: false,
      type: null,
      error: 'Path exists but is not a git repository (missing .git folder)',
    };
  }

  // Check if it looks like a URL but not GitHub
  if (/^https?:\/\//.test(trimmedSource)) {
    return {
      valid: false,
      type: null,
      error: 'Only GitHub URLs are currently supported',
    };
  }

  return {
    valid: false,
    type: null,
    error: 'Path does not exist on filesystem',
  };
}

/**
 * Clone a git repository to a target path
 * @throws Error if clone fails
 */
export function cloneRepository(url: string, targetPath: string): void {
  try {
    execSync(`git clone "${url}" "${targetPath}"`, {
      stdio: 'pipe',
      timeout: 120000, // 2 minute timeout for large repos
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to clone repository: ${message}`);
  }
}

/**
 * Extract repository name from a GitHub URL
 */
export function extractRepoName(url: string): string {
  // Match patterns like:
  // https://github.com/user/repo
  // https://github.com/user/repo.git
  // https://www.github.com/user/repo
  const match = url.match(/github\.com\/[^/]+\/([^/.]+)/);
  return match ? match[1] : 'imported-repo';
}

/**
 * Generate a short unique ID for naming
 */
export function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}
