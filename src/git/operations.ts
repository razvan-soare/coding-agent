import { execSync } from 'child_process';

export interface GitStatus {
  hasChanges: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export function getGitStatus(cwd: string): GitStatus {
  try {
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' });
    const lines = status.trim().split('\n').filter(Boolean);

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const indexStatus = line[0];
      const workingStatus = line[1];
      const file = line.slice(3);

      if (indexStatus === '?') {
        untracked.push(file);
      } else {
        if (indexStatus !== ' ') staged.push(file);
        if (workingStatus !== ' ') unstaged.push(file);
      }
    }

    return {
      hasChanges: lines.length > 0,
      staged,
      unstaged,
      untracked,
    };
  } catch {
    return { hasChanges: false, staged: [], unstaged: [], untracked: [] };
  }
}

export function stageAllChanges(cwd: string): void {
  execSync('git add -A', { cwd, encoding: 'utf-8' });
}

export interface GitAuthor {
  name: string;
  email: string;
}

export function commit(cwd: string, message: string, author?: GitAuthor): string {
  // Escape message for shell
  const escapedMessage = message.replace(/"/g, '\\"');

  if (author?.name && author?.email) {
    // Use -c flags to set author for this commit only
    execSync(
      `git -c user.name="${author.name}" -c user.email="${author.email}" commit -m "${escapedMessage}"`,
      { cwd, encoding: 'utf-8' }
    );
  } else {
    execSync(`git commit -m "${escapedMessage}"`, { cwd, encoding: 'utf-8' });
  }
  return getLatestCommitSha(cwd);
}

export function getLatestCommitSha(cwd: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

export function push(cwd: string, remote = 'origin', branch?: string): void {
  const currentBranch = branch || getCurrentBranch(cwd);
  execSync(`git push ${remote} ${currentBranch}`, { cwd, encoding: 'utf-8' });
}

export function getCurrentBranch(cwd: string): string {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return 'main';
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export function initGitRepo(cwd: string): void {
  execSync('git init', { cwd, encoding: 'utf-8' });
}

export function hasRemote(cwd: string, remote = 'origin'): boolean {
  try {
    execSync(`git remote get-url ${remote}`, { cwd, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export function resetToLastCommit(cwd: string): boolean {
  try {
    // Check if there are any commits
    const hasCommits = getLatestCommitSha(cwd) !== '';

    if (hasCommits) {
      // Reset all changes to last commit
      execSync('git reset --hard HEAD', { cwd, encoding: 'utf-8' });
      // Clean untracked files
      execSync('git clean -fd', { cwd, encoding: 'utf-8' });
    } else {
      // No commits yet, just clean up
      execSync('git checkout -- . 2>/dev/null || true', { cwd, encoding: 'utf-8' });
      execSync('git clean -fd', { cwd, encoding: 'utf-8' });
    }
    return true;
  } catch (error) {
    console.warn('Failed to reset git state:', error);
    return false;
  }
}

export function stashChanges(cwd: string, message?: string): boolean {
  try {
    const status = getGitStatus(cwd);
    if (!status.hasChanges) return true;

    const stashMsg = message || `auto-stash-${Date.now()}`;
    execSync(`git stash push -m "${stashMsg}" --include-untracked`, { cwd, encoding: 'utf-8' });
    return true;
  } catch (error) {
    console.warn('Failed to stash changes:', error);
    return false;
  }
}

export function getGitDiff(cwd: string): string {
  try {
    // Get diff including staged and unstaged
    return execSync('git diff HEAD', { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return '';
  }
}

export function getRemoteUrl(cwd: string, remote = 'origin'): string | null {
  try {
    return execSync(`git remote get-url ${remote}`, { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

export function setRemoteUrl(cwd: string, url: string, remote = 'origin'): void {
  if (hasRemote(cwd, remote)) {
    execSync(`git remote set-url ${remote} ${url}`, { cwd, encoding: 'utf-8' });
  } else {
    execSync(`git remote add ${remote} ${url}`, { cwd, encoding: 'utf-8' });
  }
}

export function renameBranch(cwd: string, newName: string): void {
  execSync(`git branch -M ${newName}`, { cwd, encoding: 'utf-8' });
}

export function pushWithUpstream(cwd: string, remote = 'origin', branch?: string): void {
  const currentBranch = branch || getCurrentBranch(cwd);
  execSync(`git push -u ${remote} ${currentBranch}`, { cwd, encoding: 'utf-8' });
}
