import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getProject, updateProject } from '@/lib/db';

// Helper functions for git operations
function hasRemote(cwd: string, remote = 'origin'): boolean {
  try {
    execSync(`git remote get-url ${remote}`, { cwd, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function getRemoteUrl(cwd: string, remote = 'origin'): string | null {
  try {
    return execSync(`git remote get-url ${remote}`, { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function setRemoteUrl(cwd: string, url: string, remote = 'origin'): void {
  if (hasRemote(cwd, remote)) {
    execSync(`git remote set-url ${remote} ${url}`, { cwd, encoding: 'utf-8' });
  } else {
    execSync(`git remote add ${remote} ${url}`, { cwd, encoding: 'utf-8' });
  }
}

function getCurrentBranch(cwd: string): string {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return 'main';
  }
}

function renameBranch(cwd: string, newName: string): void {
  execSync(`git branch -M ${newName}`, { cwd, encoding: 'utf-8' });
}

function pushWithUpstream(cwd: string, remote = 'origin', branch?: string): void {
  const currentBranch = branch || getCurrentBranch(cwd);
  execSync(`git push -u ${remote} ${currentBranch}`, { cwd, encoding: 'utf-8' });
}

// GET - Get current repository status
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const remoteUrl = getRemoteUrl(project.path);
    const currentBranch = getCurrentBranch(project.path);

    return NextResponse.json({
      connected: !!remoteUrl,
      remoteUrl,
      currentBranch,
      repository_url: project.repository_url,
    });
  } catch (error) {
    console.error('Error getting repository status:', error);
    return NextResponse.json(
      { error: 'Failed to get repository status' },
      { status: 500 }
    );
  }
}

// POST - Connect repository (set remote and push)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { url, renameBranchToMain = true } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'Repository URL is required' },
        { status: 400 }
      );
    }

    const project = getProject(id);

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Convert HTTPS URL to SSH if needed for authentication
    let gitUrl = url;
    if (url.startsWith('https://github.com/')) {
      gitUrl = url.replace('https://github.com/', 'git@github.com:');
      if (!gitUrl.endsWith('.git')) {
        gitUrl += '.git';
      }
    }

    // Set remote URL
    setRemoteUrl(project.path, gitUrl);

    // Optionally rename branch to main
    if (renameBranchToMain) {
      const currentBranch = getCurrentBranch(project.path);
      if (currentBranch !== 'main') {
        renameBranch(project.path, 'main');
      }
    }

    // Push with upstream tracking
    pushWithUpstream(project.path);

    // Update project with repository URL
    updateProject(id, { repository_url: url });

    const updatedProject = getProject(id);

    return NextResponse.json({
      success: true,
      remoteUrl: gitUrl,
      currentBranch: getCurrentBranch(project.path),
      project: updatedProject,
    });
  } catch (error) {
    console.error('Error connecting repository:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to connect repository: ${message}` },
      { status: 500 }
    );
  }
}
