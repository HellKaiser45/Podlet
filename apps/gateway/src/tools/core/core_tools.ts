import { ChatCompletionTool, ChatCompletionToolMessageParam } from 'openai/resources/chat/completions';
import type { SeeImageReceipt } from '@podlet/types';
import { VirtualFileSystem, resolveWithin } from '../../system/sandbox';
import { prepareImage, normaliseMime, type PreparedImage } from '../../system/vision';
import { visionCache } from '../../system/vision-cache';

interface ITool {
  name: string;
  definition: ChatCompletionTool;
  execute(args: Record<string, unknown>): Promise<unknown>;
  setVfs?(vfs: VirtualFileSystem): void;
}

// Extensions that read_file refuses. Binary content is unreadable as text and
// would only waste context, so it is rejected with a pointer to the right tool.
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.wav', '.ogg', '.zip', '.tar', '.gz', '.bin', '.exe',
]);

// Image extensions readable by the vision pipeline (see_image)
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.avif',
]);

// Extensions actually decoded by see_image
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

type ImageDetail = 'auto' | 'high';
const DETAIL_MAX_EDGE: Record<ImageDetail, number> = { auto: 1568, high: 2576 };

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
        'Reads one or more files in parallel.',
        'Returns a JSON object mapping each relative path to its text content.',
        'DO NOT use for binary/media files — use see_image to view an image.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            description: 'One or more relative file paths to read (e.g. workspace/src/main.ts, artifacts/out/report.md)',
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
        if (IMAGE_MIME_BY_EXT[ext]) {
          return [p, `error: cannot read binary file "${p}" (${ext}) — use see_image to view it`];
        }
        if (BINARY_EXTENSIONS.has(ext)) {
          return [p, `error: cannot read binary file "${p}" (${ext})`];
        }
        try {
          const realPath = this.vfs!.resolveVirtual(p);
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
        '- The cwd is your run root: `cat workspace/foo` and `cat artifacts/foo` both just work',
        '- All paths are relative to the run root and start with workspace/, artifacts/ or skills/',
        '- Absolute paths (/tmp, /etc, ~) are rejected',
        '- Shell output may leak real filesystem paths — always continue using relative paths in follow-up tool calls',
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
            description: 'Optional directory inside the run root to run in (e.g. artifacts). Defaults to the run root.',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds. Default: 30, Min: 1, Max: 300.',
            minimum: 1,
            maximum: 300,
          },
        },
        required: ['command'],
      },
    },
  };

  private vfs?: VirtualFileSystem;
  setVfs(vfs: VirtualFileSystem) { this.vfs = vfs; }

  async execute(args: Record<string, any>): Promise<ShellExecutionResult> {
    const { command, working_directory, timeout = 30 } = args;
    const startTime = Date.now();
    let timedOut = false;

    try {
      const runRoot = this.vfs?.runRoot;
      if (!runRoot) throw new Error('VirtualFileSystem not initialized');

      const cwd = typeof working_directory === 'string' && working_directory.trim() !== ''
        ? resolveWithin(runRoot, working_directory)
        : runRoot;

      const proc = Bun.spawn(['bash', '-c', command], {
        cwd,
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
        'Only writes to artifacts/ — workspace/ and skills/ are read-only.',
        'For small targeted edits to existing files, use apply_diff instead (more token-efficient).',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path under artifacts/ (e.g. artifacts/src/main.ts). No leading slash.',
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
        'Only works on artifacts/ files.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path under artifacts/ (e.g. artifacts/src/main.ts).',
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
        'Copy files from read-only workspace/ to writable artifacts/, preserving directory structure.',
        'ALWAYS call this before editing any workspace/ file — it creates the editable copy you can then modify with write_file or apply_diff.',
        'Files already staged in artifacts/ are skipped safely.',
        'Accepts individual files or entire directories.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            description: 'workspace/ paths to copy to artifacts/ (files or directories)',
            items: {
              type: 'string',
              description: 'e.g. workspace/src/components/App.tsx or workspace/src/',
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
// SeeImageTool
// ---------------------------------------------------------------------------

class SeeImageTool implements ITool {
  readonly name = 'see_image';
  private vfs?: VirtualFileSystem;

  readonly definition: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'see_image',
      description: [
        'ALWAYS use this tool to look at an image (.png .jpg .jpeg .webp .gif) in workspace/ or artifacts/.',
        'NEVER use read_file or execute_shell for images — read_file refuses binary files and shell output is text.',
        '',
        'The images are attached to the conversation; you will see them after this call returns.',
        'Call again with `crop` to zoom into a region instead of re-reading the whole image.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            description: 'One or more relative image paths to look at (e.g. workspace/screenshots/home.png, artifacts/out/chart.jpg)',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 4,
          },
          detail: {
            type: 'string',
            enum: ['auto', 'high'],
            description: 'auto = 1568px long edge (~1.1k tokens, default); high = up to 2576px long edge for dense UI text, ~3-5x the tokens.',
          },
          crop: {
            type: 'object',
            description: 'Zoom into a region of the image. `fraction` (0..1 of the image) is the safer default — it survives different image sizes and render scales.',
            properties: {
              x: { type: 'number', description: 'Left offset of the region.' },
              y: { type: 'number', description: 'Top offset of the region.' },
              width: { type: 'number', description: 'Width of the region.' },
              height: { type: 'number', description: 'Height of the region.' },
              unit: {
                type: 'string',
                enum: ['px', 'fraction'],
                description: 'Interpretation of x/y/width/height. `fraction` is 0..1 of the image; `px` is source pixels.',
              },
            },
            required: ['x', 'y', 'width', 'height', 'unit'],
          },
        },
        required: ['paths'],
      },
    },
  };

  constructor(vfs?: VirtualFileSystem) { this.vfs = vfs; }
  setVfs(vfs: VirtualFileSystem) { this.vfs = vfs; }

  async execute(
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; images: SeeImageReceipt[]; errors: string[] }> {
    const paths = args.paths as string[] | undefined;
    if (!paths || paths.length === 0) throw new Error('Missing required argument: paths');
    if (!this.vfs) return { ok: false, images: [], errors: ['VirtualFileSystem not initialized'] };

    const detail = (args.detail as ImageDetail | undefined) ?? 'auto';
    const maxEdge = DETAIL_MAX_EDGE[detail] ?? DETAIL_MAX_EDGE.auto;
    const crop = args.crop as { x: number; y: number; width: number; height: number; unit: 'px' | 'fraction' } | undefined;

    const images: SeeImageReceipt[] = [];
    const errors: string[] = [];

    await Promise.all(
      paths.map(async (p): Promise<void> => {
        try {
          const realPath = this.vfs!.resolveVirtual(p);
          const file = Bun.file(realPath);
          if (!(await file.exists())) {
            errors.push(`${p}: file not found`);
            return;
          }

          const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
          const mime = IMAGE_MIME_BY_EXT[ext];
          if (!mime) {
            errors.push(`${p}: unsupported image type "${ext.replace(/^\./, '')}" (supported: png, jpg, jpeg, webp, gif)`);
            return;
          }

          const sourceBytes = new Uint8Array(await file.arrayBuffer());
          const prepared = await prepareImage(sourceBytes, normaliseMime(mime), { maxEdge, crop });

          if ('ok' in prepared && (prepared as { ok: false }).ok === false) {
            errors.push(`${p}: ${(prepared as { reason: string }).reason}`);
            return;
          }

          const image = prepared as PreparedImage;

          // Cache the prepared bytes so the first hydration after this call is
          // a hit with no file I/O and no decoding.
          const b64 = Buffer.from(image.bytes).toString('base64');
          visionCache.set(image.sha, {
            b64,
            mime: image.mime,
            width: image.width,
            height: image.height,
            bytes: image.bytes.byteLength,
          });

          const stat = await file.stat();

          images.push({
            vpath: p,
            id: p,
            sha: image.sha,
            source: {
              mime,
              width: image.sourceWidth,
              height: image.sourceHeight,
              bytes: sourceBytes.byteLength,
              mtime_ms: stat.mtime.getTime(),
            },
            rendered: {
              mime: image.mime,
              width: image.width,
              height: image.height,
              bytes: image.bytes.byteLength,
              max_edge: maxEdge,
              format: image.mime === 'image/jpeg' ? 'jpeg' : 'png',
              crop: crop ?? null,
            },
            tokens_est: image.tokensEst,
            dropped_from_context: false,
          });
        } catch (err) {
          errors.push(`${p}: ` + this.vfs!.sanitizeErrorMessage(err));
        }
      })
    );

    return { ok: images.length > 0, images, errors };
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
  private readonly seeImageTool = new SeeImageTool();

  constructor(virtualFileSystem?: VirtualFileSystem) {
    // Always register ALL tools so getToolDefinitions() works without VFS
    const allTools: ITool[] = [
      this.readFileTool, this.shellTool, this.writeFileTool,
      this.applyDiffTool, this.stageFilesTool, this.seeImageTool,
    ];
    this.tools = new Map(allTools.map(tool => [tool.name, tool]));

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

  async execute(
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>
  ): Promise<ChatCompletionToolMessageParam> {
    const tool = this.tools.get(toolName);
    if (!tool) return this.makeError(toolCallId, `Core tool not found: ${toolName}`);

    // ── Shell: special handling ────────────────────────────────────────────
    // Shell needs real paths for cwd, so we resolve args before execution.
    // stdout/stderr are sanitized afterwards to strip any leaked real paths.
    if (toolName === 'execute_shell') {
      if (!this.vfs) return this.makeShellError(toolCallId, 'VirtualFileSystem not initialized');

      // ShellTool itself resolves `working_directory` against the run root and
      // defaults to it, so arguments are forwarded untouched. Only the output
      // needs sanitising, because commands like `pwd` print real paths.
      const result = await tool.execute(args) as ShellExecutionResult;

      // Sanitize stdout and stderr — commands like `pwd` or `ls -la` will
      // print real filesystem paths that must not reach the model.
      const sanitized: ShellExecutionResult = {
        ...result,
        stdout: this.vfs.sanitizeErrorMessage(result.stdout),
        stderr: this.vfs.sanitizeErrorMessage(result.stderr),
      };

      return { role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(sanitized) };
    }

    // ── All other tools: relative paths passed directly ───────────────────
    // Tools resolve paths internally via VFS, so:
    //   (a) no real-path resolution before execute()
    //   (b) no real paths in results → no leaks
    // We still sanitize the full output JSON as a safety net.

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
}

let cachedDefinitions: ChatCompletionTool[] | null = null;

/**
 * Tool schemas for the current core tool set. Definitions do not depend on a
 * VFS, so they are built once instead of constructing a throwaway
 * CoreToolsManager on every request.
 */
export function getCoreToolDefinitions(): ChatCompletionTool[] {
  cachedDefinitions ??= new CoreToolsManager().getToolDefinitions();
  return cachedDefinitions;
}