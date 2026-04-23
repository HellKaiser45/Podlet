import { ChatCompletionTool, ChatCompletionToolMessageParam } from 'openai/resources/chat/completions';
import { VirtualFileSystem } from '../../system/sandbox';
import { mkdir } from 'node:fs/promises';

interface ITool {
  name: string;
  definition: ChatCompletionTool;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

const UNREADABLE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.wav', '.ogg', '.zip', '.tar', '.gz', '.bin', '.exe',
]);

class ReadFileTool {
  readonly name = 'read_file';
  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'read_file',
      description: `Read the contents of one or more files from the virtual filesystem in an effective manner with BUN + async parallelization.
Returns a JSON object mapping each absolute file path to its contents.
DO NOT use this tool for binary or media files (.png, .jpg, .pdf, .woff, .mp4, etc.) — it only handles text-based files.`,
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            description: 'One or more virtual file path to read.',
            items: {
              type: 'string',
              description: 'A virtual file path (e.g. workspace://project/main.ts, or skills://..., or artifacts://...)',
            },
            minItems: 1,
          },
        },
        required: ['paths'],
      },
    },
  };

  async execute(args: Record<string, unknown>): Promise<string[]> {
    const paths = args.paths as string[] | undefined;
    if (!paths || paths.length === 0) {
      throw new Error('Missing required argument: paths');
    }

    return Promise.all(
      paths.map(async p => {
        const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
        if (UNREADABLE_EXTENSIONS.has(ext)) {
          return `error: cannot read binary file "${p}" (${ext})`;
        }
        const exists = await Bun.file(p).exists();
        return exists ? Bun.file(p).text() : `error: file not found`;
      })
    );
  }
}

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

const RELATIVE_PATH_PATTERN = /(\s|^)(find|du)\s+\./;

/**
 * Shell command execution tool
 */
class ShellTool {
  readonly name = 'execute_shell';
  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'execute_shell',
      description: `
Execute a shell command and return its output. Suitable for short-running commands that complete and exit.
RECOMMENDED USAGE:
- Read files: cat file.txt, head -n 20 file.txt, tail -f logs.txt
- File operations: cp, mv, mkdir, rm
- Text processing: sed, awk, cut, sort
- Git operations: git status, git log, git diff
- Package info: npm list, bun pm ls
- working_directory is the sandbox root — all relative paths resolve inside it
- Inside command, ALWAYS use relative paths: mkdir -p temp, not mkdir -p /temp
- Absolute paths like /temp, /var, /home bypass the sandbox entirely and are blocked
- Think of working_directory as your "/" — navigate relatively from there
NOT SUITABLE FOR:
- Long-running servers (npm run dev, python server.py)
- Interactive commands (vim, nano, ssh)
- Watch modes (npm run watch, nodemon)
- Background processes (use systemd/pm2 instead)

DO NOT:
- use any command that returns a full path
- use relative path exploration: find ., du . — always use absolute virtual paths (workspace://...)
- use a traversal command to go backward in filetree
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
            description: 'Working directory for command execution.Where the command will be executed. Must be a virtual path (workspace://, artifacts://, skills://).'
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds. Default: 30, Min: 1, Max: 300. Commands exceeding timeout will be terminated.',
            minimum: 1,
            maximum: 300
          }
        },
        required: ['command', 'working_directory']
      },
    }
  };

  async execute(args: Record<string, any>): Promise<ShellExecutionResult> {
    const {
      command,
      working_directory,
      timeout = 30
    } = args;

    const startTime = Date.now();
    let timedOut = false;

    if (!working_directory || working_directory.includes('://')) {
      return {
        success: false,
        stdout: '',
        stderr: 'working_directory is required — provide a virtual path (workspace://, artifacts://, skills://)',
        exitCode: null,
        timedOut: false,
        duration: 0,
      };
    }

    if (RELATIVE_PATH_PATTERN.test(command)) {
      return {
        success: false,
        stdout: '',
        stderr: `Relative path commands like "find ." or "ls ." are not allowed. Use absolute virtual paths instead.`,
        exitCode: null,
        timedOut: false,
        duration: 0,
      };
    }

    try {
      await mkdir(working_directory, { recursive: true });

      const proc = Bun.spawn(['bash', '-c', command], {
        cwd: working_directory,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          DEBIAN_FRONTEND: 'noninteractive',
        },
      });

      // Set a hard kill timer — no Promise.race needed
      const killTimer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout * 1000);

      // Guard stream reads: if the process is killed, the streams close abruptly
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text().catch(() => ''),
        new Response(proc.stderr).text().catch(() => ''),
        proc.exited,
      ]);

      clearTimeout(killTimer);

      const duration = Date.now() - startTime;

      if (timedOut) {
        return {
          success: false,
          stdout,
          stderr: stderr + `\n\n[Command timed out after ${timeout}s and was terminated]`,
          exitCode: null,
          timedOut: true,
          duration,
        };
      }

      return {
        success: exitCode === 0,
        stdout,
        stderr,
        exitCode,
        timedOut: false,
        duration,
      };

    } catch (error) {
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        timedOut,
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * Core Tools Manager
 * Manages built-in tools that are always available
 */
export class CoreToolsManager {
  private tools: Map<string, ITool> = new Map();
  private vfs?: VirtualFileSystem;

  constructor(virtualFileSystem?: VirtualFileSystem) {
    const shellTool = new ShellTool();
    this.tools.set(shellTool.name, shellTool);

    const readFileTool = new ReadFileTool();
    this.tools.set(readFileTool.name, readFileTool);

    this.vfs = virtualFileSystem;
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
    args: Record<string, unknown>
  ): Promise<ChatCompletionToolMessageParam> {
    const tool = this.tools.get(toolName);
    if (!this.vfs) throw new Error('Virtual File System not initialized');

    try {
      this.validateAllPaths(args);
    } catch (err) {
      return {
        role: "tool",
        tool_call_id: toolCallId,
        content: `Security violation: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const resolvedArgs = this.vfs.resolveArgs(args);

    if (!tool) {
      return {
        role: "tool",
        tool_call_id: toolCallId,
        content: `Core tool not found: ${toolName}`,
      };
    }

    const result = await tool.execute(resolvedArgs);
    return {
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify(result),
    };
  }

  private validateAllPaths(value: unknown): void {
    if (typeof value === 'string') {
      this.vfs!.validatePaths(value);
    } else if (Array.isArray(value)) {
      for (const item of value) this.validateAllPaths(item);
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value)) this.validateAllPaths(v);
    }
  }

  /**
   * Check if any tools in a list are core tools
   */
  hasCoreTools(toolNames: string[]): boolean {
    return toolNames.some(name => this.isCoreTool(name));
  }
}
