import { ChatCompletionTool, ChatCompletionToolMessageParam } from 'openai/resources/chat/completions';
import { VirtualFileSystem } from '../../system/sandbox';
import { mkdir } from 'node:fs/promises';

interface ITool {
  name: string;
  definition: ChatCompletionTool;
  execute(args: Record<string, unknown>): Promise<unknown>;
  setVfs?(vfs: VirtualFileSystem): void;
}

const UNREADABLE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.wav', '.ogg', '.zip', '.tar', '.gz', '.bin', '.exe',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.wav', '.ogg', '.zip', '.tar', '.gz', '.bin', '.exe',
]);

// ---------------------------------------------------------------------------
// ReadFileTool
// ---------------------------------------------------------------------------

class ReadFileTool implements ITool {
  readonly name = 'read_file';
  private vfs?: VirtualFileSystem;

  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'read_file',
      description: [
        'ALWAYS use this tool to read file contents.',
        'NEVER use cat, head, tail, grep, or any shell command to read files — use this tool instead.',
        '',
        'Reads one or more files from the virtual filesystem in parallel.',
        'Returns a JSON object mapping each virtual path to its text content.',
        'DO NOT use for binary/media files (.png, .jpg, .pdf, .woff, .mp4, etc.).',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            description: 'One or more virtual file paths to read (e.g. workspace://src/main.ts, artifacts://out/report.md)',
            items: { type: 'string' },
            minItems: 1,
          },
        },
        required: ['paths'],
      },
    },
  };

  setVfs(vfs: VirtualFileSystem) { this.vfs = vfs; }

  async execute(args: Record<string, unknown>): Promise<Record<string, string>> {
    const paths = args.paths as string[] | undefined;
    if (!paths || paths.length === 0) throw new Error('Missing required argument: paths');
    if (!this.vfs) throw new Error('VirtualFileSystem not initialized');

    const entries = await Promise.all(
      paths.map(async (p): Promise<[string, string]> => {
        const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
        if (UNREADABLE_EXTENSIONS.has(ext)) {
          return [p, `error: cannot read binary file "${p}" (${ext})`];
        }
        try {
          const realPath = this.vfs!.virtualToReal(p);
          const file = Bun.file(realPath);
          if (!(await file.exists())) return [p, `error: file not found`];
          return [p, await file.text()];
        } catch (err) {
          return [p, `error: ${this.vfs!.sanitizeErrorMessage(err)}`];
        }
      })
    );

    return Object.fromEntries(entries);
  }
}

// ---------------------------------------------------------------------------
// ShellTool
// ---------------------------------------------------------------------------

export interface ShellExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  duration: number;
}

class ShellTool implements ITool {
  readonly name = 'execute_shell';

  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'execute_shell',
      description: [
        'Execute a shell command for builds, tests, installs, git operations, and other executable tasks.',
        'NEVER use this to read or write files — use read_file, write_file, and apply_diff instead.',
        'NEVER use cat, echo, tee, sed, awk, patch, or similar to handle file content.',
        '',
        'RULES:',
        '- working_directory must be a virtual path (workspace://, artifacts://, skills://)',
        '- Inside commands, use RELATIVE paths only — working_directory is treated as your root',
        '- Never use absolute paths like /tmp, /home, /var — they bypass the sandbox',
        '- Shell output may leak real filesystem paths — always continue using virtual paths in follow-up tool calls',
        '',
        'NOT FOR: long-running servers, interactive commands (vim/ssh), watch modes, background processes.',
        'Timeout: default 30s, max 300s.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to execute with bash -c',
          },
          working_directory: {
            type: 'string',
            description: 'Virtual path for the working directory (workspace://, artifacts://, skills://)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds. Default: 30, Min: 1, Max: 300.',
            minimum: 1,
            maximum: 300,
          },
        },
        required: ['command', 'working_directory'],
      },
    },
  };

  // Shell does not need VFS directly (manager resolves args before passing)
  async execute(args: Record<string, any>): Promise<ShellExecutionResult> {
    const { command, working_directory, timeout = 30 } = args;
    const startTime = Date.now();
    let timedOut = false;

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

      const killTimer = setTimeout(() => { timedOut = true; proc.kill(); }, timeout * 1000);

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text().catch(() => ''),
        new Response(proc.stderr).text().catch(() => ''),
        proc.exited,
      ]);

      clearTimeout(killTimer);
      const duration = Date.now() - startTime;

      if (timedOut) {
        return { success: false, stdout, stderr: stderr + `\n\n[Command timed out after ${timeout}s and was terminated]`, exitCode: null, timedOut: true, duration };
      }

      return { success: exitCode === 0, stdout, stderr, exitCode, timedOut: false, duration };
    } catch (error) {
      return {
        success: false, stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null, timedOut, duration: Date.now() - startTime,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// WriteFileTool
// ---------------------------------------------------------------------------

class WriteFileTool implements ITool {
  readonly name = 'write_file';
  private vfs?: VirtualFileSystem;

  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'write_file',
      description: [
        'ALWAYS use this tool to create new files or completely overwrite existing ones.',
        'NEVER use echo, tee, printf, heredoc, or any shell command to write file content.',
        '',
        'Only writes to artifacts:// — workspace:// is read-only.',
        'For small targeted edits to existing files, use apply_diff instead (more token-efficient).',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Virtual path in artifacts:// (e.g. artifacts://src/main.ts). No leading slash after the scheme.',
          },
          content: {
            type: 'string',
            description: 'Complete file content to write.',
          },
        },
        required: ['path', 'content'],
      },
    },
  };

  constructor(vfs?: VirtualFileSystem) { this.vfs = vfs; }
  setVfs(vfs: VirtualFileSystem) { this.vfs = vfs; }

  async execute(args: Record<string, unknown>): Promise<{ success: boolean; path: string; bytes: number; error?: string }> {
    if (!this.vfs) return { success: false, path: '', bytes: 0, error: 'VirtualFileSystem not initialized' };

    const path = args.path as string | undefined;
    const content = args.content as string | undefined;

    if (!path || content === undefined) {
      return { success: false, path: path ?? '', bytes: 0, error: 'Missing required arguments: path and content' };
    }

    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return { success: false, path, bytes: 0, error: `Cannot write binary file (${ext}). Use execute_shell for binary operations.` };
    }

    if (content.length > 100_000) {
      return { success: false, path, bytes: 0, error: `Content too large (${content.length} chars, max 100,000). Use apply_diff for targeted edits or execute_shell for large files.` };
    }

    try {
      await this.vfs.atomicWrite(path, content);
      // Return the original virtual path, not any resolved real path
      return { success: true, path, bytes: Buffer.byteLength(content) };
    } catch (err) {
      return { success: false, path, bytes: 0, error: this.vfs.sanitizeErrorMessage(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// ApplyDiffTool
// ---------------------------------------------------------------------------

interface DiffOperation { search: string; replace: string; }

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class ApplyDiffTool implements ITool {
  readonly name = 'apply_diff';
  private vfs?: VirtualFileSystem;

  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'apply_diff',
      description: [
        'ALWAYS use this tool to make targeted edits to existing files.',
        'NEVER use sed, awk, patch, or shell commands to edit file content.',
        '',
        'More token-efficient than write_file for small changes.',
        'Finds exact text matches and replaces them sequentially.',
        'Include 3+ surrounding context lines in "search" to guarantee a unique match.',
        'Only works on artifacts:// files.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Virtual path in artifacts:// (e.g. artifacts://src/main.ts).',
          },
          diffs: {
            type: 'array',
            description: 'List of search-and-replace operations applied sequentially.',
            items: {
              type: 'object',
              properties: {
                search: {
                  type: 'string',
                  description: 'Exact text to find in the file. Include 3+ surrounding context lines for a unique match.',
                },
                replace: {
                  type: 'string',
                  description: 'Replacement text.',
                },
              },
              required: ['search', 'replace'],
            },
            minItems: 1,
          },
        },
        required: ['path', 'diffs'],
      },
    },
  };

  constructor(vfs?: VirtualFileSystem) { this.vfs = vfs; }
  setVfs(vfs: VirtualFileSystem) { this.vfs = vfs; }

  async execute(args: Record<string, unknown>): Promise<{ success: boolean; path: string; changes: number; errors: string[] }> {
    if (!this.vfs) return { success: false, path: '', changes: 0, errors: ['VirtualFileSystem not initialized'] };

    const path = args.path as string | undefined;
    const diffs = args.diffs as DiffOperation[] | undefined;

    if (!path || !diffs || diffs.length === 0) {
      return { success: false, path: path ?? '', changes: 0, errors: ['Missing required arguments: path and diffs'] };
    }

    try {
      const content = await this.vfs.readFileTextByVPath(path);
      let result = content;
      const errors: string[] = [];
      let changes = 0;

      for (let i = 0; i < diffs.length; i++) {
        const { search, replace } = diffs[i];
        const count = (result.match(new RegExp(escapeRegex(search), 'g')) || []).length;

        if (count === 0) {
          errors.push(`Diff ${i + 1}: Search text not found. Verify the exact text exists in the file.`);
          continue;
        }
        if (count > 1) {
          errors.push(`Diff ${i + 1}: Ambiguous — found ${count} occurrences. Add more surrounding context lines for a unique match.`);
          continue;
        }

        result = result.replace(search, replace);
        changes++;
      }

      if (changes > 0) await this.vfs.atomicWrite(path, result);
      // Return the original virtual path
      return { success: errors.length === 0, path, changes, errors };
    } catch (err) {
      return { success: false, path: path ?? '', changes: 0, errors: [this.vfs.sanitizeErrorMessage(err)] };
    }
  }
}

// ---------------------------------------------------------------------------
// StageFilesTool
// ---------------------------------------------------------------------------

class StageFilesTool implements ITool {
  readonly name = 'stage_files';
  private vfs?: VirtualFileSystem;

  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'stage_files',
      description: [
        'Copy files from read-only workspace:// to writable artifacts://, preserving directory structure.',
        'ALWAYS call this before editing any workspace:// file — it creates the editable copy you can then modify with write_file or apply_diff.',
        'Files already staged in artifacts:// are skipped safely.',
        'Accepts individual files or entire directories.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            description: 'workspace:// paths to copy to artifacts:// (files or directories)',
            items: {
              type: 'string',
              description: 'e.g. workspace://src/components/App.tsx or workspace://src/',
            },
            minItems: 1,
          },
        },
        required: ['paths'],
      },
    },
  };

  constructor(vfs?: VirtualFileSystem) { this.vfs = vfs; }
  setVfs(vfs: VirtualFileSystem) { this.vfs = vfs; }

  async execute(args: Record<string, unknown>): Promise<{ staged: string[]; skipped: string[]; errors: string[] }> {
    if (!this.vfs) return { staged: [], skipped: [], errors: ['VirtualFileSystem not initialized'] };
    const paths = args.paths as string[] | undefined;
    if (!paths || paths.length === 0) return { staged: [], skipped: [], errors: ['Missing required argument: paths'] };
    return this.vfs.stageFiles(paths);
  }
}

// ---------------------------------------------------------------------------
// CoreToolsManager
// ---------------------------------------------------------------------------

export class CoreToolsManager {
  private readonly tools: Map<string, ITool>;
  private vfs?: VirtualFileSystem;

  // Kept as named fields so setVirtualFileSystem can call setVfs on each
  private readonly readFileTool = new ReadFileTool();
  private readonly shellTool = new ShellTool();
  private readonly writeFileTool = new WriteFileTool();
  private readonly applyDiffTool = new ApplyDiffTool();
  private readonly stageFilesTool = new StageFilesTool();

  constructor(virtualFileSystem?: VirtualFileSystem) {
    // Always register ALL tools so getToolDefinitions() works without VFS
    this.tools = new Map<string, ITool>([
      [this.readFileTool.name, this.readFileTool],
      [this.shellTool.name, this.shellTool],
      [this.writeFileTool.name, this.writeFileTool],
      [this.applyDiffTool.name, this.applyDiffTool],
      [this.stageFilesTool.name, this.stageFilesTool],
    ]);

    if (virtualFileSystem) this.setVirtualFileSystem(virtualFileSystem);
  }

  /**
   * Inject VFS after construction.
   * Must be called before executing any VFS-dependent tool.
   */
  setVirtualFileSystem(vfs: VirtualFileSystem): void {
    this.vfs = vfs;
    for (const tool of this.tools.values()) {
      tool.setVfs?.(vfs);
    }
  }

  isCoreTool(toolName: string): boolean { return this.tools.has(toolName); }
  getToolDefinitions(): ChatCompletionTool[] { return [...this.tools.values()].map(t => t.definition); }
  getToolNames(): string[] { return [...this.tools.keys()]; }
  filterCoreTools(toolNames: string[]): string[] { return toolNames.filter(n => this.isCoreTool(n)); }
  filterNonCoreTools(toolNames: string[]): string[] { return toolNames.filter(n => !this.isCoreTool(n)); }
  hasCoreTools(toolNames: string[]): boolean { return toolNames.some(n => this.isCoreTool(n)); }

  async execute(
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>
  ): Promise<ChatCompletionToolMessageParam> {
    const tool = this.tools.get(toolName);
    if (!tool) return this.makeError(toolCallId, `Core tool not found: ${toolName}`);

    // ── Shell: special handling ────────────────────────────────────────────
    // Shell needs real paths for cwd, so we resolve args for it specifically.
    // It also does not touch the VFS, so no sanitization is needed.
    if (toolName === 'execute_shell') {
      const wd = args.working_directory as string | undefined;

      if (!wd?.trim()) {
        return this.makeShellError(toolCallId,
          'working_directory is required. Provide a virtual path (workspace://, artifacts://, skills://).'
        );
      }

      const validSchemes = ['workspace://', 'artifacts://', 'skills://'];
      if (!validSchemes.some(s => wd.startsWith(s))) {
        return this.makeShellError(toolCallId,
          `working_directory must start with workspace://, artifacts://, or skills://. Received: "${wd}"`
        );
      }

      if (!this.vfs) return this.makeShellError(toolCallId, 'VirtualFileSystem not initialized');

      // Resolve virtual paths → real paths so the shell gets a real cwd
      const resolvedArgs = this.vfs.resolveArgs(args);
      const result = await tool.execute(resolvedArgs);
      return { role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result) };
    }

    // ── All other tools: virtual paths passed directly ────────────────────
    // Tools resolve paths internally via VFS, so:
    //   (a) no real-path resolution before execute()
    //   (b) no real paths in results → no leaks
    // We still sanitize the full output JSON as a safety net.

    try {
      this.validateAllPaths(args);
    } catch (err) {
      return this.makeError(toolCallId,
        `Security violation: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const result = await tool.execute(args);

    // Sanitize the entire JSON output to catch any accidental real-path leaks
    const raw = JSON.stringify(result);
    const sanitized = this.vfs ? this.vfs.sanitizeErrorMessage(raw) : raw;

    return { role: 'tool', tool_call_id: toolCallId, content: sanitized };
  }

  private makeError(toolCallId: string, message: string): ChatCompletionToolMessageParam {
    return { role: 'tool', tool_call_id: toolCallId, content: message };
  }

  private makeShellError(toolCallId: string, stderr: string): ChatCompletionToolMessageParam {
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({
        success: false, stdout: '', stderr,
        exitCode: null, timedOut: false, duration: 0,
      }),
    };
  }

  private validateAllPaths(value: unknown): void {
    if (typeof value === 'string') {
      this.vfs?.validatePaths(value);
    } else if (Array.isArray(value)) {
      for (const item of value) this.validateAllPaths(item);
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value)) this.validateAllPaths(v);
    }
  }
}
