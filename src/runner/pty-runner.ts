import * as pty from 'node-pty';
import { CONFIG } from '../utils/config.js';

export interface RunResult {
  success: boolean;
  output: string;
  timedOut: boolean;
  duration: number;
  exitCode: number | null;
}

export interface RunOptions {
  command: string;
  args: string[];
  cwd: string;
  inactivityTimeoutMs?: number;
  onOutput?: (data: string) => void;
}

const QUESTION_PATTERNS = [
  /\?\s*$/,
  /\(y\/n\)/i,
  /\(yes\/no\)/i,
  /continue\?/i,
  /proceed\?/i,
  /confirm/i,
  /Press enter/i,
  /\[Y\/n\]/,
  /\[y\/N\]/,
];

const AUTO_RESPONSES: Array<{ pattern: RegExp; response: string }> = [
  { pattern: /\(y\/n\)/i, response: 'y\n' },
  { pattern: /\(yes\/no\)/i, response: 'yes\n' },
  { pattern: /\[Y\/n\]/i, response: 'Y\n' },
  { pattern: /\[y\/N\]/i, response: 'y\n' },
  { pattern: /continue\?/i, response: 'y\n' },
  { pattern: /proceed\?/i, response: 'y\n' },
  { pattern: /confirm/i, response: 'y\n' },
  { pattern: /Press enter/i, response: '\n' },
];

function isQuestionPrompt(text: string): boolean {
  return QUESTION_PATTERNS.some(pattern => pattern.test(text));
}

function getAutoResponse(text: string): string | null {
  for (const { pattern, response } of AUTO_RESPONSES) {
    if (pattern.test(text)) {
      return response;
    }
  }
  if (isQuestionPrompt(text)) {
    return 'y\n';
  }
  return null;
}

export function runCommand(options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const {
      command,
      args,
      cwd,
      inactivityTimeoutMs = CONFIG.inactivityTimeoutMs,
      onOutput,
    } = options;

    const startTime = Date.now();
    let output = '';
    let lastActivityTime = Date.now();
    let timedOut = false;
    let exitCode: number | null = null;
    let recentOutput = '';

    const ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
    });

    const inactivityTimer = setInterval(() => {
      const inactiveMs = Date.now() - lastActivityTime;
      if (inactiveMs > inactivityTimeoutMs) {
        timedOut = true;
        ptyProcess.kill();
      }
    }, 1000);

    ptyProcess.onData((data) => {
      lastActivityTime = Date.now();
      output += data;
      recentOutput += data;

      if (onOutput) {
        onOutput(data);
      }

      // Keep only last 500 chars for pattern matching
      if (recentOutput.length > 500) {
        recentOutput = recentOutput.slice(-500);
      }

      // Check if we should auto-respond
      const response = getAutoResponse(recentOutput);
      if (response) {
        setTimeout(() => {
          ptyProcess.write(response);
          recentOutput = '';
        }, 100);
      }
    });

    ptyProcess.onExit(({ exitCode: code }) => {
      clearInterval(inactivityTimer);
      exitCode = code;

      resolve({
        success: code === 0 && !timedOut,
        output,
        timedOut,
        duration: Date.now() - startTime,
        exitCode,
      });
    });
  });
}

export async function runClaudeCode(options: {
  prompt: string;
  cwd: string;
  inactivityTimeoutMs?: number;
  onOutput?: (data: string) => void;
}): Promise<RunResult> {
  const args = [
    '-p', options.prompt,
    '--dangerously-skip-permissions',
    '--verbose',
  ];

  return runCommand({
    command: CONFIG.claudeCodePath,
    args,
    cwd: options.cwd,
    inactivityTimeoutMs: options.inactivityTimeoutMs,
    onOutput: options.onOutput,
  });
}
