import { spawn, ChildProcess, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createServer } from 'net';

export interface ProjectInstance {
  projectId: string;
  projectPath: string;
  port: number;
  pid: number;
  status: 'starting' | 'running' | 'stopped' | 'error' | 'orphaned';
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

// Persistence file for instance state
const STATE_FILE = join(process.cwd(), '.instances-state.json');

// Save instance state to file
function saveState(): void {
  try {
    const state = Array.from(instances.entries()).map(([id, inst]) => ({
      ...inst,
      // Only persist running/starting instances
    })).filter(inst => inst.status === 'running' || inst.status === 'starting');
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[Instance] Failed to save state:', err);
  }
}

// Load instance state from file and check if processes are still alive
function loadState(): void {
  try {
    if (!existsSync(STATE_FILE)) return;

    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ProjectInstance[];

    for (const inst of state) {
      // Check if the port is still in use (process still running)
      if (!isPortAvailable(inst.port)) {
        // Process is still running, mark as orphaned since we don't have the handle
        inst.status = 'orphaned';
        instances.set(inst.projectId, inst);
        usedPorts.add(inst.port);
        console.log(`[Instance] Restored orphaned instance for ${inst.projectId} on port ${inst.port}`);
      }
    }
  } catch (err) {
    console.error('[Instance] Failed to load state:', err);
  }
}

// Initialize: load persisted state
loadState();

// Check if a port is available
function isPortAvailable(port: number): boolean {
  try {
    // Use ss (more widely available than lsof)
    const result = execSync(`ss -tlnH sport = :${port} 2>/dev/null || true`, { encoding: 'utf-8' });
    return result.trim() === '';
  } catch {
    return true; // Assume available if check fails
  }
}

function getNextPort(): number {
  let port = BASE_PORT;
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    if (!usedPorts.has(port) && isPortAvailable(port)) {
      usedPorts.add(port);
      return port;
    }
    port += PORT_INCREMENT;
    attempts++;
  }

  // Fallback: just use the next port in our tracking
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
      return { command: 'npm', args: ['run', 'dev', '--', '-H', '0.0.0.0'], portFlag: '-p' };
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
  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
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

  // Build the full command as a string for shell execution
  let command: string;
  if (projectType.portFlag === 'PORT') {
    // Create React App uses environment variable
    command = `PORT=${port} ${projectType.command} ${projectType.args.join(' ')}`;
  } else {
    command = `${projectType.command} ${projectType.args.join(' ')} ${projectType.portFlag} ${port}`;
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
    // Bind to all interfaces so it's accessible via Tailscale
    env.HOSTNAME = '0.0.0.0';

    console.log(`[Instance] Starting project at ${projectPath} with command: ${command}`);

    const child = spawn(command, [], {
      cwd: projectPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: true,
    });

    instance.pid = child.pid || 0;
    processes.set(projectId, child);

    // Listen for output to detect when server is ready
    let output = '';
    let errorOutput = '';

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(`[Instance ${projectId}] stdout:`, text.trim());
      // Common patterns that indicate server is ready
      if (output.includes('Ready') || output.includes('ready') || output.includes('localhost:') || output.includes('Local:')) {
        const inst = instances.get(projectId);
        if (inst && inst.status === 'starting') {
          inst.status = 'running';
          instances.set(projectId, inst);
          saveState();
        }
      }
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      console.log(`[Instance ${projectId}] stderr:`, text.trim());
      // Next.js outputs to stderr for some messages
      if (text.includes('Ready') || text.includes('ready') || text.includes('Local:')) {
        const inst = instances.get(projectId);
        if (inst && inst.status === 'starting') {
          inst.status = 'running';
          instances.set(projectId, inst);
          saveState();
        }
      }
    });

    child.on('error', (err) => {
      console.error(`[Instance ${projectId}] error:`, err);
      const inst = instances.get(projectId);
      if (inst) {
        inst.status = 'error';
        inst.error = err.message;
        instances.set(projectId, inst);
      }
      releasePort(port);
    });

    child.on('exit', (code, signal) => {
      console.log(`[Instance ${projectId}] exited with code ${code}, signal ${signal}`);
      const inst = instances.get(projectId);
      if (inst) {
        inst.status = 'stopped';
        if (code !== 0 && code !== null) {
          inst.error = `Process exited with code ${code}. ${errorOutput.slice(-500)}`;
        }
        instances.set(projectId, inst);
      }
      processes.delete(projectId);
      releasePort(port);
    });

    // Unref so the parent process can exit
    child.unref();

    instances.set(projectId, instance);

    // After 5 seconds, assume it's running if still in 'starting' state
    setTimeout(() => {
      const inst = instances.get(projectId);
      if (inst && inst.status === 'starting') {
        inst.status = 'running';
        instances.set(projectId, inst);
      }
    }, 5000);

    return instance;
  } catch (err) {
    console.error(`[Instance ${projectId}] spawn error:`, err);
    releasePort(port);
    instance.status = 'error';
    instance.error = err instanceof Error ? err.message : 'Failed to start process';
    instances.set(projectId, instance);
    return instance;
  }
}

// Kill all processes on a specific port
function killProcessesOnPort(port: number): boolean {
  try {
    // Get PIDs using ss and parse output
    // ss output format: LISTEN 0 511 0.0.0.0:4000 0.0.0.0:* users:(("next-server",pid=12345,fd=22))
    const result = execSync(`ss -tlnp sport = :${port} 2>/dev/null || true`, { encoding: 'utf-8' });

    // Extract PIDs from the output using regex
    const pidMatches = result.match(/pid=(\d+)/g);
    if (!pidMatches || pidMatches.length === 0) {
      // Try fuser as fallback
      try {
        const fuserResult = execSync(`fuser ${port}/tcp 2>/dev/null || true`, { encoding: 'utf-8' });
        const fuserPids = fuserResult.trim().split(/\s+/).filter(Boolean);
        if (fuserPids.length === 0) {
          return true; // No processes to kill
        }
        for (const pid of fuserPids) {
          try {
            process.kill(parseInt(pid, 10), 'SIGTERM');
            console.log(`[Instance] Sent SIGTERM to PID ${pid}`);
          } catch {
            // Process might already be dead
          }
        }
      } catch {
        return true; // No processes found
      }
    } else {
      const pids = pidMatches.map(m => m.replace('pid=', ''));
      console.log(`[Instance] Found PIDs on port ${port}:`, pids);

      for (const pid of pids) {
        try {
          process.kill(parseInt(pid, 10), 'SIGTERM');
          console.log(`[Instance] Sent SIGTERM to PID ${pid}`);
        } catch (err) {
          console.log(`[Instance] SIGTERM failed for PID ${pid}, trying SIGKILL`);
          try {
            process.kill(parseInt(pid, 10), 'SIGKILL');
          } catch {
            // Process might already be dead
          }
        }
      }
    }

    // Give processes a moment to die
    execSync('sleep 0.5');

    // Verify port is now free
    return isPortAvailable(port);
  } catch (err) {
    console.error('[Instance] Failed to kill processes on port:', err);
    return false;
  }
}

export function stopProject(projectId: string): ProjectInstance | null {
  const instance = instances.get(projectId);
  const child = processes.get(projectId);

  if (!instance) {
    return null;
  }

  console.log(`[Instance] Stopping project ${projectId}, pid: ${instance.pid}, status: ${instance.status}`);

  // For orphaned instances, we need to kill by port since we don't have the process handle
  if (instance.status === 'orphaned') {
    const killed = killProcessesOnPort(instance.port);
    if (killed) {
      releasePort(instance.port);
      instance.status = 'stopped';
      instances.set(projectId, instance);
      saveState();
      return instance;
    } else {
      instance.error = 'Failed to kill orphaned process';
      instances.set(projectId, instance);
      return instance;
    }
  }

  if (child && child.pid) {
    try {
      // Kill the process group (negative PID kills the group)
      process.kill(-child.pid, 'SIGTERM');
      console.log(`[Instance] Sent SIGTERM to process group -${child.pid}`);
    } catch (err) {
      console.log(`[Instance] SIGTERM failed, trying SIGKILL:`, err);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Process might already be dead
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore - process is already dead
        }
      }
    }
    processes.delete(projectId);
  }

  releasePort(instance.port);
  instance.status = 'stopped';
  instances.set(projectId, instance);
  saveState();

  return instance;
}

// Check for orphaned processes on common ports and return info
export function detectOrphanedProcess(projectId: string, projectPath: string): ProjectInstance | null {
  // Scan ports in our range to find anything running
  for (let port = BASE_PORT; port < BASE_PORT + PORT_INCREMENT * 20; port += PORT_INCREMENT) {
    if (!isPortAvailable(port)) {
      // Found something running, create orphaned instance
      const instance: ProjectInstance = {
        projectId,
        projectPath,
        port,
        pid: 0,
        status: 'orphaned',
        startedAt: new Date().toISOString(),
      };
      instances.set(projectId, instance);
      usedPorts.add(port);
      return instance;
    }
  }
  return null;
}

export function getProjectInstance(projectId: string): ProjectInstance | null {
  const instance = instances.get(projectId);

  // If we have an instance, verify it's still accurate
  if (instance) {
    if (instance.status === 'running' || instance.status === 'orphaned') {
      // Check if port is still in use
      if (isPortAvailable(instance.port)) {
        // Process died, update status
        instance.status = 'stopped';
        instances.set(projectId, instance);
        releasePort(instance.port);
        saveState();
      }
    }
    return instance;
  }

  return null;
}

// Get instance with auto-detection of orphans
export function getOrDetectInstance(projectId: string, projectPath: string): ProjectInstance | null {
  const instance = getProjectInstance(projectId);
  if (instance) return instance;

  // No tracked instance, check if there's an orphaned process
  return detectOrphanedProcess(projectId, projectPath);
}

export function getAllInstances(): ProjectInstance[] {
  return Array.from(instances.values());
}
