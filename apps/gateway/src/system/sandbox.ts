import { join, extname } from "path";
import { readdir, unlink, mkdir, rmdir, rm } from "node:fs/promises";
import type { FileResponse, FileUpload, VirtualScheme } from "../types";
import { VIRTUAL_SCHEMES, } from "../types";
import SkillsManager from "./skills";
import { ChatCompletionContentPart, ChatCompletionUserMessageParam } from "openai/resources.js";
import { type OfficeContentNode, type HeadingMetadata, type ListMetadata, parseOffice } from 'officeparser'

const DOCUMENT_EXTENSIONS = new Set([
  'docx', 'odt', 'rtf',
  'pptx', 'odp',
  'xlsx', 'xls', 'ods',
  'pdf',
])

const SCHEME_RESOLVERS: Record<VirtualScheme, (ctx: { rootDir: string; runId: string; cwd?: string }) => string> = {
  "workspace://": ({ rootDir, runId, cwd }) => cwd ?? join(rootDir, "workspace", runId),
  "artifacts://": ({ rootDir, runId, cwd }) => cwd ?? join(rootDir, "artifacts", runId),
  "skills://": ({ rootDir }) => join(rootDir, "skills")
};

export class VirtualFileSystem {
  private readonly rootDir: string;
  private readonly runId: string;
  private readonly cwd?: string;
  private readonly allowedskillslocation: string[]


  private readonly ignoreList = new Set([
    // Version control
    ".git", ".svn", ".hg",
    // Dependencies
    "node_modules", ".pnp", ".yarn",
    // Python
    ".venv", "venv", "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache", "*.egg-info", ".tox",
    // Build outputs
    "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "target", "bin", "obj",
    // Editors & IDEs
    ".vscode", ".idea", ".fleet",
    // Env & secrets
    ".env", ".env.local", ".env.production", ".env.*",
    // Lock files
    "bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Cargo.lock",
    // OS
    ".DS_Store", "Thumbs.db",
    // Misc
    ".cache", "coverage", ".turbo", "tmp", "temp", "logs",
  ]);
  private readonly ignoreExtensions = new Set([
    ".min.js", ".min.css", ".map", ".lock", ".log",
  ]);

  constructor(rootDir: string, runId: string, cwd?: string, skillmanager?: SkillsManager, skills: string[] = []) {
    this.rootDir = rootDir;
    this.runId = runId;
    this.cwd = cwd;
    this.allowedskillslocation = skills
      .flatMap(name => {
        const skill = skillmanager?.availableSkills[name];
        return skill ? [skill.location] : [];
      }) ?? [];
  }

  async upload(input: FileUpload, scheme: VirtualScheme = 'workspace://'): Promise<FileResponse[]> {
    const schemeRoot = SCHEME_RESOLVERS[scheme]({ rootDir: this.rootDir, runId: this.runId, cwd: this.cwd });
    await mkdir(schemeRoot, { recursive: true });

    const results = await Promise.all(input.files.map(async (file) => {
      const buffer = await file.arrayBuffer()
      const resolved = await this.resolveAttachment(buffer, file.type, file.name)

      if (!resolved) {
        console.warn(`Skipping unsupported file: ${file.name} (${file.type})`)
        return null
      }

      let storedFilename: string

      if (resolved.type === 'image') {
        storedFilename = file.name
        await Bun.write(join(schemeRoot, storedFilename), file)
      } else if (resolved.type === 'text') {
        storedFilename = file.name
        await Bun.write(join(schemeRoot, storedFilename), resolved.content)
      } else {
        storedFilename = file.name.replace(/\.[^.]+$/, '.md')
        await Bun.write(join(schemeRoot, storedFilename), resolved.content)
      }

      return {
        name: storedFilename,
        vpath: scheme + storedFilename,
        id: Buffer.from(scheme + storedFilename).toString('base64url')
      }
    }))

    return results.filter((r): r is FileResponse => r !== null)
  }

  async listFiles(scheme: VirtualScheme): Promise<FileResponse[]> {
    const realPath = SCHEME_RESOLVERS[scheme]({ rootDir: this.rootDir, runId: this.runId, cwd: this.cwd });
    await mkdir(realPath, { recursive: true });

    let files: string[];
    try {
      files = (await readdir(realPath, { recursive: true })) as string[];
    } catch {
      return [];
    }

    return this.filterFiles(files).sort().map(file => {
      const vpath = scheme + file;

      // Determine type based on extension
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file);
      const type = isImage ? 'image' : 'text';

      return {
        name: file,
        vpath,
        id: Buffer.from(vpath).toString('base64url'),
        type
      };
    });
  }

  resolveArgs(args: Record<string, unknown>): Record<string, unknown> {
    const resolveValue = (value: unknown): unknown => {
      if (typeof value === "string") return this.resolveInString(value);
      if (Array.isArray(value)) return value.map(resolveValue);
      if (value !== null && typeof value === "object")
        return this.resolveArgs(value as Record<string, unknown>);
      return value;
    };

    return Object.fromEntries(
      Object.entries(args).map(([key, value]) => [key, resolveValue(value)])
    );
  }

  /**
   * Scan a string that potentially contains a virtual
   * resolve it to a real absolute path.
   */
  resolveInString(input: string): string {
    const schemePattern = VIRTUAL_SCHEMES.map(s => s.replace("//", "\\/\\/")).join("|");
    const regex = new RegExp(`(${schemePattern})`, "g");
    return input.replace(regex, (scheme) => {
      const resolved = SCHEME_RESOLVERS[scheme as VirtualScheme]({ rootDir: this.rootDir, runId: this.runId, cwd: this.cwd });
      return resolved.endsWith("/") ? resolved : resolved + "/";
    });
  }

  /**
   * convert a virtual path to a real absolute path.
   */
  virtualToReal(virtual: string): string {
    const scheme = VIRTUAL_SCHEMES.find(s => virtual.startsWith(s));
    if (!scheme) throw new Error(`Invalid Path: "${virtual}"`);

    if (scheme === "skills://") {
      const realskillpath = join(this.rootDir, "skills", virtual.slice(scheme.length))
      if (!this.allowedskillslocation.some(allowed => realskillpath === allowed || realskillpath.startsWith(allowed + "/"))) {
        throw new Error(`Unauthorized skill path: "${virtual}"`);
      }
    }

    const rel = virtual.slice(scheme.length);

    return join(SCHEME_RESOLVERS[scheme]({ rootDir: this.rootDir, runId: this.runId, cwd: this.cwd }), rel)
  }

  /**
   * Translates a real absolute path back to a virtual path.
   */
  realToVirtual(realPath: string): string {

    for (const scheme of VIRTUAL_SCHEMES) {
      const root = SCHEME_RESOLVERS[scheme]({ rootDir: this.rootDir, runId: this.runId, cwd: this.cwd });
      if (realPath.startsWith(root)) {
        return scheme + realPath.slice(root.length + 1)
      }
    }
    throw new Error(`Path outside virtual scope: "${realPath}"`);
  }


  // --- Optimized Read Operations ---

  /**
   * Returns a BunFile instance 
   * Does not read file contents until .text()/.blob() etc is called.
   */
  public getFile(fileId: string) {
    const virtualPath = Buffer.from(fileId, 'base64url').toString();
    const realPath = this.virtualToReal(virtualPath);
    return Bun.file(realPath)
  }

  /**
   * Reads text content from a file.
   */
  public async readFileText(fileId: string): Promise<string> {
    const file = this.getFile(fileId);
    return await file.text();
  }

  public async updateFile(fileId: string, content: string | Blob | ArrayBuffer): Promise<void> {
    const virtualPath = Buffer.from(fileId, 'base64url').toString();
    const realPath = this.virtualToReal(virtualPath);
    await Bun.write(realPath, content);
  }

  public async deleteFile(fileId: string): Promise<void> {
    const virtualPath = Buffer.from(fileId, 'base64url').toString();
    const realPath = this.virtualToReal(virtualPath);
    await unlink(realPath);
  }

  // --- Optimized Tree Generation ---
  private async getSchemeTree(scheme: VirtualScheme): Promise<string> {
    const realPath = SCHEME_RESOLVERS[scheme]({ rootDir: this.rootDir, runId: this.runId, cwd: this.cwd });
    await mkdir(realPath, { recursive: true });

    let files: string[];
    try {
      files = (await readdir(realPath, { recursive: true })) as string[];
    } catch {
      return `${scheme}\n  (empty)`;
    }

    const filtered = this.filterFiles(files);
    if (filtered.length === 0) return `${scheme}\n  (empty)`;

    return `${scheme}\n` + filtered.sort().map(f => `  ${f}`).join("\n");
  }

  public async getContextTree(): Promise<string> {
    const AGENT_SCHEMES = VIRTUAL_SCHEMES.filter(s => s !== ("skills://" satisfies VirtualScheme));
    const trees = await Promise.all(AGENT_SCHEMES.map(s => this.getSchemeTree(s)));
    const tree = trees.join("\n\n");
    return `
<filesystem_context>
## Virtual Filesystem

You operate in a fully isolated virtual filesystem. The file tree below is **exhaustive and complete** — it contains every file that exists. There are no hidden files, no other directories, and no external sources to check.

**ABSOLUTE RULES — never violated under any circumstance:**
1. A file not listed in the tree below **does not exist**. Do not reference it, guess its path, or attempt to access it.
2. All paths MUST begin with \`workspace://\` or \`artifacts://\`. No exceptions.
3. Never emit real filesystem paths (\`/etc\`, \`~\`, \`../\`, URLs, etc.).
4. \`workspace://\` is **read-only**. Never write to it.
5. \`artifacts://\` is your **write space**. All files you produce go here.
6. DO NOT TRY TO READ IMAGE FILES LIKE PNGS, GIFS, JPEGS, etc. — they are not supported AND WILL BREAK YOU.

**If a file you need does not appear in the tree: stop and tell the user. Do not speculate about where it might be.**

## Schemes
- **workspace://** — User-provided input files. Read-only source of truth.
- **artifacts://** — Your working output space. Write all produced files here.

## Complete File Tree
${tree}
</filesystem_context>`.trim();
  }

  private readonly SHELL_SYSTEM_PATHS = new Set([
    '/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr',
  ]);

  validatePaths(input: string): void {
    // FIX 1: Strip ANY heredoc marker, not just 'EOF'
    // Captures the marker name from << 'MARKER' or << MARKER, then strips until ^MARKER$
    const strippedHeredoc = input.replace(
      /<<\s*['"]?(\w+)['"]?.*?^\1$/gms,
      ''
    );

    // Path traversal check (unchanged)
    if (/(\.\.[/\\])|(\/\.\.)/.test(strippedHeredoc)) {
      throw new Error(`Path traversal (..) is strictly forbidden.`);
    }

    // FIX 2: Only block URLs that appear as standalone tokens, not fragments in string literals.
    // Require https?:// or ftp:// to be preceded by a word boundary or quote/equals,
    // so 'tps://' or concatenated strings don't false-positive.
    if (/(?<![a-z])https?:\/\/|(?<![a-z])ftp:\/\//.test(strippedHeredoc)) {
      throw new Error(`Web URLs are not allowed.`);
    }

    // Absolute path check (unchanged)
    const tokens = strippedHeredoc.split(/\s+/);
    const ctx = { rootDir: this.rootDir, runId: this.runId, cwd: this.cwd };
    const allowedRoots = VIRTUAL_SCHEMES.map(s => SCHEME_RESOLVERS[s](ctx));
    for (let token of tokens) {
      const cleanToken = token.replace(/['"]/g, '');
      if (/^\/[a-zA-Z0-9_~]/.test(cleanToken)) {
        if (this.SHELL_SYSTEM_PATHS.has(cleanToken)) continue;
        const isAllowed = allowedRoots.some(root => cleanToken.startsWith(root));
        if (!isAllowed) {
          throw new Error(`Unauthorized absolute path: "${cleanToken}". Use relative paths or virtual schemes (workspace://).`);
        }
      }
      if (cleanToken.startsWith('~/')) {
        throw new Error(`Access to home directory (~) is forbidden.`);
      }
    }

    // FIX 2 continued: guard scheme detection the same way
    const usedSchemes = strippedHeredoc.match(/(?<![a-z])[a-z]+:\/\//g) ?? [];
    for (const scheme of usedSchemes) {
      if (!VIRTUAL_SCHEMES.includes(scheme as VirtualScheme)) {
        throw new Error(`Unknown scheme "${scheme}"`);
      }
    }
  }

  private filterFiles(files: string[]): string[] {
    return files.filter(file => {
      const parts = file.split(/\/|\\/);
      if (parts.some(part => this.ignoreList.has(part))) return false;
      if (this.ignoreExtensions.has(extname(file))) return false;
      return true;
    });
  }

  async getAttachmentCategory(
    mime: string,
    filename: string,
    buffer: ArrayBuffer
  ): Promise<'image' | 'text' | 'document' | null> {
    if (mime.startsWith('image/')) return 'image'

    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'

    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer)
      return 'text'
    } catch {
      return null
    }
  }

  astToMarkdown(nodes: OfficeContentNode[]): string {
    return nodes.map(node => {
      switch (node.type) {
        case 'heading': {
          const meta = node.metadata as HeadingMetadata | undefined
          const level = '#'.repeat(meta?.level ?? 1)
          return `${level} ${node.text}`
        }
        case 'paragraph':
          return node.text
        case 'list': {
          const meta = node.metadata as ListMetadata | undefined
          const prefix = meta?.listType === 'ordered'
            ? `${(meta.itemIndex ?? 0) + 1}.`
            : '-'
          const indent = '  '.repeat(meta?.indentation ?? 0)
          return `${indent}${prefix} ${node.text}`
        }
        case 'table': {
          const rows = (node.children ?? [])
            .filter(r => r.type === 'row')
            .map(row =>
              (row.children ?? [])
                .filter(c => c.type === 'cell')
                .map(cell => (cell.text ?? '').replace(/\|/g, '\\|').trim())
                .join(' | ')
            )
          if (rows.length === 0) return ''
          const separator = rows[0].split(' | ').map(() => '---').join(' | ')
          return [
            `| ${rows[0]} |`,
            `| ${separator} |`,
            ...rows.slice(1).map(r => `| ${r} |`)
          ].join('\n')
        }
        case 'note':
          return `> ${node.text}`
        default:
          return node.text ?? ''
      }
    })
      .filter(Boolean)
      .join('\n\n')
  }

  async resolveAttachment(
    buffer: ArrayBuffer,
    mime: string,
    filename: string
  ): Promise<
    | { type: 'image'; content: ArrayBuffer }
    | { type: 'text'; content: string }
    | { type: 'document'; content: string }
    | null
  > {
    const category = await this.getAttachmentCategory(mime, filename, buffer)

    switch (category) {
      case 'image': {
        return { type: 'image', content: buffer }
      }
      case 'text': {
        const text = new TextDecoder().decode(buffer)
        return { type: 'text', content: text }
      }
      case 'document': {
        const ast = await parseOffice(Buffer.from(buffer))
        const markdown = this.astToMarkdown(ast.content)
        return { type: 'text', content: `${markdown}` }
      }
      case null:
        return null
    }
  }

  async generateContentBlock(fileIDs: string[], message: ChatCompletionUserMessageParam): Promise<ChatCompletionUserMessageParam> {
    const Pcontentblock = fileIDs.map(async (fileID): Promise<ChatCompletionContentPart> => {
      const file = this.getFile(fileID)
      if (file.type.startsWith('image/')) {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`
          }
        }
      } else {
        return {
          type: 'text',
          text: await file.text()
        }
      }
    })
    const contentblock = await Promise.all(Pcontentblock)
    const initcontentblock: ChatCompletionContentPart[] = Array.isArray(message.content) ? message.content : [{
      type: 'text',
      text: message.content
    }]

    return {
      role: "user",
      content: [...contentblock, ...initcontentblock]
    }
  }

  async deleteFolder(runid: string) {
    const DELETABLE_SCHEMES = VIRTUAL_SCHEMES.filter(s => s !== ("skills://" satisfies VirtualScheme));
    for (const scheme of DELETABLE_SCHEMES) {
      const path_to_delete = SCHEME_RESOLVERS[scheme]({ rootDir: this.rootDir, runId: runid })
      await rm(path_to_delete, { recursive: true, force: true });
    }
  }
}
