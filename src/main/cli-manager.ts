import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

export interface ClaudeCodeOptions {
  allowed_tools?: string[];
  max_turns?: number;
  max_budget_usd?: number;
  bare_mode?: boolean;
  session_id?: string;
}

export interface CliExecutionResult {
  id: string;
  output: string;
  cost_usd?: number;
  duration_ms: number;
  exit_code: number;
}

export class CliManager {
  private processes: Map<string, ChildProcess> = new Map();
  private maxConcurrent: number = 3;
  private runningCount: number = 0;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  async execute(
    request: { model: string; messages: any[]; stream?: boolean },
    options: ClaudeCodeOptions = {}
  ): Promise<CliExecutionResult> {
    const startTime = Date.now();
    const taskId = uuidv4();

    // Check if claude command is available
    const claudeAvailable = await this.checkClaudeInstalled();
    if (!claudeAvailable) {
      throw new Error('Claude Code CLI not found. Please install it first.');
    }

    // Build the prompt from messages
    const prompt = this.buildPrompt(request.messages);

    // Build command arguments
    const args = this.buildArgs(prompt, options);

    return new Promise((resolve, reject) => {
      // Check concurrency limit
      if (this.runningCount >= this.maxConcurrent) {
        reject(new Error('Maximum concurrent CLI processes reached'));
        return;
      }

      this.runningCount++;

      const child = spawn('claude', args, {
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ''
        },
        cwd: process.cwd()
      });

      this.processes.set(taskId, child);

      let stdout = '';
      let stderr = '';
      let costUsd: number | undefined;

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;

        // Try to parse cost from output if available
        const costMatch = text.match(/Cost: \$([0-9.]+)/);
        if (costMatch) {
          costUsd = parseFloat(costMatch[1]);
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        this.runningCount--;
        this.processes.delete(taskId);

        if (code === 0) {
          resolve({
            id: taskId,
            output: stdout.trim(),
            cost_usd: costUsd,
            duration_ms: Date.now() - startTime,
            exit_code: code || 0
          });
        } else {
          reject(new Error(`CLI process exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        this.runningCount--;
        this.processes.delete(taskId);
        reject(err);
      });
    });
  }

  private async checkClaudeInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version']);
      
      child.on('error', () => {
        resolve(false);
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });
    });
  }

  private buildPrompt(messages: any[]): string {
    // Combine all messages into a single prompt
    return messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const content = typeof m.content === 'string' ? m.content : 
        m.content.map((c: any) => c.text || '').join('');
      return `${role}: ${content}`;
    }).join('\n\n');
  }

  private buildArgs(prompt: string, options: ClaudeCodeOptions): string[] {
    const args: string[] = [];

    // Add prompt
    args.push('-p', prompt);

    // Add output format
    args.push('--output-format', 'stream-json');

    // Add allowed tools
    if (options.allowed_tools && options.allowed_tools.length > 0) {
      args.push('--allowedTools', options.allowed_tools.join(','));
    }

    // Add max turns
    if (options.max_turns) {
      args.push('--max-turns', options.max_turns.toString());
    }

    // Add max budget
    if (options.max_budget_usd) {
      args.push('--max-budget-usd', options.max_budget_usd.toString());
    }

    // Add bare mode
    if (options.bare_mode) {
      args.push('--bare');
    }

    return args;
  }

  async killProcess(taskId: string): Promise<void> {
    const child = this.processes.get(taskId);
    if (child) {
      child.kill('SIGTERM');
      this.processes.delete(taskId);
    }
  }

  async killAll(): Promise<void> {
    for (const [taskId, child] of this.processes.entries()) {
      child.kill('SIGTERM');
    }
    this.processes.clear();
    this.runningCount = 0;
  }
}
