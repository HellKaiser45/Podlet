import { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * Result of a shell command execution
 */
export interface ShellExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  duration: number;
}

/**
 * Shell command execution tool
 */
class ShellTool {
  readonly name = 'execute_shell';

  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'execute_shell',
      description: `Execute a shell command and return its output. Suitable for short-running commands that complete and exit.

RECOMMENDED USAGE:
- Read files: cat file.txt, head -n 20 file.txt, tail -f logs.txt
- Search: rg "pattern" src/, grep -r "text" .
- List files: ls -la, find . -name "*.ts"
- File operations: cp, mv, mkdir, rm
- Text processing: sed, awk, cut, sort
- Git operations: git status, git log, git diff
- Package info: npm list, bun pm ls

NOT SUITABLE FOR:
- Long-running servers (npm run dev, python server.py)
- Interactive commands (vim, nano, ssh)
- Watch modes (npm run watch, nodemon)
- Background processes (use systemd/pm2 instead)

Commands have a 30-second default timeout. Use shorter timeouts for quick checks, longer (up to 300s) for builds/tests.`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute. Will be run with bash -c "command"'
          },
          working_directory: {
            type: 'string',
            description: 'Working directory for command execution (default: current directory)'
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds. Default: 30, Min: 1, Max: 300. Commands exceeding timeout will be terminated.',
            minimum: 1,
            maximum: 300
          }
        },
        required: ['command']
      }
    }
  };

  async execute(args: Record<string, any>): Promise<ShellExecutionResult> {
    const {
      command,
      working_directory = process.cwd(),
      timeout = 30
    } = args;

    const startTime = Date.now();
    let timedOut = false;

    try {
      console.log(`🐚 Executing: ${command}`);
      console.log(`   CWD: ${working_directory}`);
      console.log(`   Timeout: ${timeout}s`);

      const proc = Bun.spawn(['bash', '-c', command], {
        cwd: working_directory,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          DEBIAN_FRONTEND: 'noninteractive',
        }
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          proc.kill();
          reject(new Error('TIMEOUT'));
        }, timeout * 1000);
      });

      const processPromise = (async () => {
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        return { stdout, stderr, exitCode };
      })();

      let stdout = '';
      let stderr = '';
      let exitCode: number | null = null;

      try {
        const result = await Promise.race([processPromise, timeoutPromise]) as any;
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode;
      } catch (error: any) {
        if (error.message === 'TIMEOUT') {
          timedOut = true;
          try {
            stdout = await new Response(proc.stdout).text();
            stderr = await new Response(proc.stderr).text();
          } catch {
            // Process already killed
          }
        } else {
          throw error;
        }
      }

      const duration = Date.now() - startTime;

      if (timedOut) {
        return {
          success: false,
          stdout,
          stderr: stderr + `\n\n[Command timed out after ${timeout}s and was terminated]`,
          exitCode: null,
          timedOut: true,
          duration
        };
      }

      const success = exitCode === 0;
      console.log(`${success ? '✅' : '❌'} Command ${success ? 'succeeded' : 'failed'} (${duration}ms)`);

      return {
        success,
        stdout,
        stderr,
        exitCode,
        timedOut: false,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        timedOut: false,
        duration
      };
    }
  }
}

/**
 * Core Tools Manager
 * Manages built-in tools that are always available
 */
export class CoreToolsManager {
  private tools: Map<string, ShellTool> = new Map();

  constructor() {
    // Register core tools
    const shellTool = new ShellTool();
    this.tools.set(shellTool.name, shellTool);

    console.log(`✅ Core tools initialized: ${Array.from(this.tools.keys()).join(', ')}`);
  }

  /**
   * Check if a tool name is a core tool
   */
  isCoreTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get all core tool definitions for the LLM
   */
  getToolDefinitions(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map(tool => tool.definition);
  }

  /**
   * Get list of all core tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Filter a list of tool names to only core tools
   */
  filterCoreTools(toolNames: string[]): string[] {
    return toolNames.filter(name => this.isCoreTool(name));
  }

  /**
   * Filter a list of tool names to exclude core tools
   */
  filterNonCoreTools(toolNames: string[]): string[] {
    return toolNames.filter(name => !this.isCoreTool(name));
  }

  /**
   * Execute a core tool by name
   * Returns a ChatCompletionMessageParam for adding to history
   */
  async execute(
    toolName: string,
    toolCallId: string,
    args: Record<string, any>
  ): Promise<ChatCompletionMessageParam> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        role: "tool" as const,
        tool_call_id: toolCallId,
        content: `Core tool not found: ${toolName}`,
      };
    }

    try {
      const result = await tool.execute(args);

      // Format output
      let content = '';

      if (result.stdout) {
        content += result.stdout;
      }

      if (result.stderr && !result.success) {
        content += result.stderr ? `\n\nSTDERR:\n${result.stderr}` : '';
      }

      if (!result.success) {
        if (result.timedOut) {
          content = `Command timed out after ${args.timeout || 30}s:\n\n${content}`;
        } else if (result.exitCode !== null) {
          content = `Command failed with exit code ${result.exitCode}:\n\n${content}`;
        } else {
          content = `Command execution error:\n\n${content}`;
        }
      }

      if (!content) {
        content = 'Command executed successfully (no output)';
      }

      return {
        role: "tool" as const,
        tool_call_id: toolCallId,
        content: content.trim(),
      };

    } catch (error) {
      console.error(`❌ Core tool execution failed: ${toolName}`, error);
      return {
        role: "tool" as const,
        tool_call_id: toolCallId,
        content: `Execution error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Check if any tools in a list are core tools
   */
  hasCoreTools(toolNames: string[]): boolean {
    return toolNames.some(name => this.isCoreTool(name));
  }
}

// Export singleton instance for convenience
export const coreTools = new CoreToolsManager();
