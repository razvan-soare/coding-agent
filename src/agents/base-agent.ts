import { runClaudeCode, type RunResult } from '../runner/pty-runner.js';
import { logAgentStart, logAgentResponse, logAgentError, logAgentComplete, type AgentType } from '../db/index.js';

export interface AgentResult {
  success: boolean;
  output: string;
  duration: number;
  timedOut: boolean;
}

export interface AgentOptions {
  runId: string;
  prompt: string;
  cwd: string;
  agentType: AgentType;
  inactivityTimeoutMs?: number;
}

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const { runId, prompt, cwd, agentType, inactivityTimeoutMs } = options;

  // Log agent start
  logAgentStart(runId, agentType, prompt);

  let outputBuffer = '';
  const onOutput = (data: string) => {
    outputBuffer += data;
  };

  try {
    const result: RunResult = await runClaudeCode({
      prompt,
      cwd,
      inactivityTimeoutMs,
      onOutput,
    });

    // Log response
    logAgentResponse(runId, agentType, result.output);

    if (result.timedOut) {
      logAgentError(runId, agentType, 'Agent timed out due to inactivity', {
        duration: result.duration,
      });
    }

    if (result.success) {
      logAgentComplete(runId, agentType, {
        duration: result.duration,
        exitCode: result.exitCode,
      });
    } else {
      logAgentError(runId, agentType, `Agent exited with code ${result.exitCode}`, {
        duration: result.duration,
        timedOut: result.timedOut,
      });
    }

    return {
      success: result.success,
      output: result.output,
      duration: result.duration,
      timedOut: result.timedOut,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logAgentError(runId, agentType, errorMessage);

    return {
      success: false,
      output: outputBuffer,
      duration: 0,
      timedOut: false,
    };
  }
}
