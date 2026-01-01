import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface ProjectInstance {
  projectId: string;
  projectPath: string;
  port: number;
  pid: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  error?: string;
}

// In-memory store for running instances
const instances = new Map<string, ProjectInstance>();
const processes = new Map<string, ChildProcess>();

// Port allocation: start at 4000, increment by 10
const BASE_PORT = 4000;
const PORT_INCREMENT = 10;
const usedPorts = new Set<number>();

function getNextPort(): number {
  let port = BASE_PORT;
  while (usedPorts.has(port)) {
    port += PORT_INCREMENT;
  }
  usedPorts.add(port);
  return port;
}

function releasePort(port: number): void {
  usedPorts.delete(port);
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function detectProjectType(projectPath: string): { command: string; args: string[]; portFlag: string } | null {
  const packageJsonPath = join(projectPath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson: PackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const scripts = packageJson.scripts || {};
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Check for Next.js
    if (deps['next']) {
      return { command: 'npm', args: ['run', 'dev', '--'], portFlag: '-p' };
    }

    // Check for Vite
    if (deps['vite']) {
      return { command: 'npm', args: ['run', 'dev', '--'], portFlag: '--port' };
    }

    // Check for Create React App
    if (deps['react-scripts']) {
      return { command: 'npm', args: ['start'], portFlag: 'PORT' }; // Uses env var
    }

    // Check for generic dev script
    if (scripts['dev']) {
      return { command: 'npm', args: ['run', 'dev', '--'], portFlag: '--port' };
    }

    if (scripts['start']) {
      return { command: 'npm', args: ['start'], portFlag: '--port' };
    }

    return null;
  } catch {
    return null;
  }
}

export function startProject(projectId: string, projectPath: string): ProjectInstance {
  // Check if already running
  const existing = instances.get(projectId);
  if (existing && existing.status === 'running') {
    return existing;
  }

  const projectType = detectProjectType(projectPath);
  if (!projectType) {
    const instance: ProjectInstance = {
      projectId,
      projectPath,
      port: 0,
      pid: 0,
      status: 'error',
      startedAt: new Date().toISOString(),
      error: 'Could not detect project type. Make sure package.json exists with a dev or start script.',
    };
    instances.set(projectId, instance);
    return instance;
  }

  const port = getNextPort();

  // Build command with port
  let args = [...projectType.args];
  if (projectType.portFlag === 'PORT') {
    // Create React App uses environment variable
    args = projectType.args;
  } else {
    args.push(projectType.portFlag, port.toString());
  }

  const instance: ProjectInstance = {
    projectId,
    projectPath,
    port,
    pid: 0,
    status: 'starting',
    startedAt: new Date().toISOString(),
  };

  try {
    const env = { ...process.env };
    if (projectType.portFlag === 'PORT') {
      env.PORT = port.toString();
    }
    // Bind to all interfaces so it's accessible via Tailscale
    env.HOST = '0.0.0.0';

    const child = spawn(projectType.command, args, {
      cwd: projectPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    instance.pid = child.pid || 0;
    processes.set(projectId, child);

    // Listen for output to detect when server is ready
    let output = '';
    child.stdout?.on('data', (data) => {
      output += data.toString();
      // Common patterns that indicate server is ready
      if (output.includes('ready') || output.includes('localhost:') || output.includes('Local:')) {
        const inst = instances.get(projectId);
        if (inst && inst.status === 'starting') {
          inst.status = 'running';
          instances.set(projectId, inst);
        }
      }
    });

    child.stderr?.on('data', (data) => {
      output += data.toString();
    });

    child.on('error', (err) => {
      const inst = instances.get(projectId);
      if (inst) {
        inst.status = 'error';
        inst.error = err.message;
        instances.set(projectId, inst);
      }
      releasePort(port);
    });

    child.on('exit', (code) => {
      const inst = instances.get(projectId);
      if (inst) {
        inst.status = 'stopped';
        if (code !== 0 && code !== null) {
          inst.error = `Process exited with code ${code}`;
        }
        instances.set(projectId, inst);
      }
      processes.delete(projectId);
      releasePort(port);
    });

    instances.set(projectId, instance);

    // After 3 seconds, assume it's running if still in 'starting' state
    setTimeout(() => {
      const inst = instances.get(projectId);
      if (inst && inst.status === 'starting') {
        inst.status = 'running';
        instances.set(projectId, inst);
      }
    }, 3000);

    return instance;
  } catch (err) {
    releasePort(port);
    instance.status = 'error';
    instance.error = err instanceof Error ? err.message : 'Failed to start process';
    instances.set(projectId, instance);
    return instance;
  }
}

export function stopProject(projectId: string): ProjectInstance | null {
  const instance = instances.get(projectId);
  const child = processes.get(projectId);

  if (!instance) {
    return null;
  }

  if (child) {
    try {
      // Kill the process group
      if (child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // Process might already be dead
      child.kill('SIGKILL');
    }
    processes.delete(projectId);
  }

  releasePort(instance.port);
  instance.status = 'stopped';
  instances.set(projectId, instance);

  return instance;
}

export function getProjectInstance(projectId: string): ProjectInstance | null {
  return instances.get(projectId) || null;
}

export function getAllInstances(): ProjectInstance[] {
  return Array.from(instances.values());
}
