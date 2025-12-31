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

export function commit(cwd: string, message: string): string {
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf-8' });
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
