import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { getProject } from '@/lib/db';

// Track running processes per project
const runningProcesses = new Map<string, { pid: number; startedAt: Date }>();

export async function POST(
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

    // Check if already running
    if (runningProcesses.has(id)) {
      return NextResponse.json(
        { error: 'A run is already in progress for this project', running: true },
        { status: 409 }
      );
    }

    // Path to the CLI
    const cliPath = resolve(process.cwd(), '../dist/index.js');

    // Spawn the orchestrator process
    const child = spawn('node', [cliPath, 'run', id], {
      cwd: resolve(process.cwd(), '..'),
      stdio: 'ignore',
      detached: true,
    });

    // Track the running process
    runningProcesses.set(id, { pid: child.pid!, startedAt: new Date() });

    // Clean up when process exits
    child.on('exit', () => {
      runningProcesses.delete(id);
    });

    child.on('error', () => {
      runningProcesses.delete(id);
    });

    // Unref so the parent can exit independently
    child.unref();

    return NextResponse.json({
      message: 'Run started',
      pid: child.pid,
    });
  } catch (error) {
    console.error('Error starting run:', error);
    return NextResponse.json(
      { error: 'Failed to start run' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const running = runningProcesses.get(id);

    return NextResponse.json({
      running: !!running,
      pid: running?.pid,
      startedAt: running?.startedAt,
    });
  } catch (error) {
    console.error('Error checking run status:', error);
    return NextResponse.json(
      { error: 'Failed to check run status' },
      { status: 500 }
    );
  }
}
