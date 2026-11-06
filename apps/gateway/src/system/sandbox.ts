import { join, extname, dirname, basename, resolve, sep } from "path";
import { realpathSync } from "node:fs";
import {
  readdir, unlink, mkdir, rm, stat, rename, copyFile, chmod, symlink, lstat, readlink,
} from "node:fs/promises";
import type { FileResponse, FileUpload } from "../types";
import SkillsManager from "./skills";
import { ChatCompletionContentPart, ChatCompletionUserMessageParam } from "openai/resources.js";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { type OfficeContentNode, type HeadingMetadata, type ListMetadata, parseOffice } from 'officeparser'
import * as fflate from 'fflate';
import { SerialQueue } from "../utils/serial-queue";

const MAX_PDF_PAGES = 20;

const DOCUMENT_EXTENSIONS = new Set([
  'docx', 'odt', 'rtf',
  'pptx', 'odp',
  'xlsx', 'xls', 'ods',
  'pdf',
]);

// ---------------------------------------------------------------------------
// Path primitives
// ---------------------------------------------------------------------------
//
// Every path the app accepts is RELATIVE and carries a mandatory first segment
// naming one of three roots: workspace, artifacts, skills. There is no second
// path language: tools, the shell (whose cwd is the run root) and the frontend
// all speak this one form.

export type VirtualRootName = "workspace" | "artifacts" | "skills";

export const VIRTUAL_ROOTS: readonly VirtualRootName[] = ["workspace", "artifacts", "skills"];

export class PathEscape extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscape";
  }
}

/**
 * True when any path segment is exactly `..`. Segment-based on purpose: a
 * filename that merely contains two dots (`..hidden`, `a..b.txt`) is legal.
 */
function hasParentSegment(rel: string): boolean {
  return rel.split(/[\\/]/).some(segment => segment === "..");
}

/**
 * realpath() that tolerates a path whose tail does not exist yet: the nearest
 * existing ancestor is resolved and the missing tail appended. Necessary
 * because writes target files (and sometimes directories) that do not exist.
 */
function realpathNearest(target: string): string {
  const parts: string[] = [];
  let current = resolve(target);

  for (;;) {
    try {
      const real = realpathSync(current);
      return parts.length > 0 ? join(real, ...parts) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(target);
      parts.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve `rel` against `root` and guarantee the result stays inside `root`.
 * The lexical path, the realpath of the parent and the realpath of the final
 * path itself are all checked, so a symlink planted at any component —
 * including the last one — cannot be used to step outside the root.
 */
export function resolveWithin(root: string, rel: string): string {
  if (hasParentSegment(rel)) {
    throw new PathEscape(`Path traversal (\.\.) is not allowed: "${rel}"`);
  }

  const absRoot = resolve(root);
  const abs = resolve(absRoot, rel);

  if (abs !== absRoot && !abs.startsWith(absRoot + sep)) {
    throw new PathEscape(`Path escapes its root: "${rel}"`);
  }

  const realRoot = realpathNearest(absRoot);
  if (abs === absRoot) return realRoot;

  const realParent = realpathNearest(dirname(abs));
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new PathEscape(`Path escapes its root through a symlink: "${rel}"`);
  }

  const result = join(realParent, basename(abs));
  const realFull = realpathNearest(result);
  if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) {
    throw new PathEscape(`Path escapes its root through a symlink: "${rel}"`);
  }

  return realFull;
}

export interface VirtualContext {
  /** The Podlet data directory (parent of workspace/, runs/, skills/). */
  podletDir: string;
  runId: string;
  /** Names of the skills assigned to this run; anything else is off-limits. */
  allowedSkills: string[];
}

/** `<podletDir>/runs/<runId>` — the shell cwd and the stable pwd. */
export function runRootPath(podletDir: string, runId: string): string {
  return join(podletDir, "runs", runId);
}

/** The real directory backing a virtual root name. */
export function rootFor(name: VirtualRootName, ctx: VirtualContext): string {
  switch (name) {
    case "workspace":
      return join(runRootPath(ctx.podletDir, ctx.runId), "workspace");
    case "artifacts":
      return join(runRootPath(ctx.podletDir, ctx.runId), "artifacts");
    case "skills":
      return join(ctx.podletDir, "skills");
  }
}

/** Split `<root>/<rest>` and return both halves, validating the root name. */
export function splitVirtual(rel: string): { root: VirtualRootName; rest: string } {
  if (typeof rel !== "string" || rel.trim() === "") {
    throw new PathEscape("Empty path");
  }

  const normalized = rel.trim().replace(/\\/g, "/");

  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new PathEscape(`Absolute paths are not allowed: "${rel}"`);
  }

  if (hasParentSegment(normalized)) {
    throw new PathEscape(`Path traversal (\.\.) is not allowed: "${rel}"`);
  }

  const slash = normalized.indexOf("/");
  const head = slash === -1 ? normalized : normalized.slice(0, slash);
  const rest = slash === -1 ? "" : normalized.slice(slash + 1);

  if (head !== "workspace" && head !== "artifacts" && head !== "skills") {
    throw new PathEscape(
      `Path must start with "workspace/", "artifacts/" or "skills/" — received "${rel}"`,
    );
  }

  return { root: head, rest };
}

/** Map a relative virtual path onto its real absolute path, or throw. */
export function resolveVirtual(rel: string, ctx: VirtualContext): string {
  const { root, rest } = splitVirtual(rel);

  if (root === "skills") {
    const skillName = rest.split("/")[0];
    if (!ctx.allowedSkills.includes(skillName)) {
      throw new PathEscape(`Skill not assigned to this run: "${skillName || rest}"`);
    }
  }

  return resolveWithin(rootFor(root, ctx), rest === "" ? "." : rest);
}

/**
 * Reuse an existing symlink (or replace a stale/missing one) without touching
 * an existing real directory. `type: 'junction'` is only meaningful on
 * Windows; POSIX ignores it, so one call covers every platform.
 */
async function ensureSymlink(target: string, linkPath: string): Promise<void> {
  try {
    const info = await lstat(linkPath);
    if (info.isSymbolicLink()) {
      const current = await readlink(linkPath);
      if (resolve(dirname(linkPath), current) === resolve(target)) return;
      await rm(linkPath, { force: true });
    } else {
      return; // a real file/dir already occupies the name — leave it alone
    }
  } catch {
    // nothing there yet
  }

  try {
    await symlink(target, linkPath, "junction");
  } catch (err) {
    console.warn(`[vfs] Could not link ${linkPath} -> ${target}:`, err);
  }
}

/**
 * Create the per-run layout:
 *   <podletDir>/runs/<runId>/              (run root, shell cwd)
 *   <podletDir>/runs/<runId>/artifacts/    (real, writable)
 *   <podletDir>/runs/<runId>/workspace/    (real, read-only input dir)
 *   <podletDir>/runs/<runId>/skills/<name> -> <podletDir>/skills/<name>
 */
export async function ensureRunRoot(
  podletDir: string,
  runId: string,
  allowedSkills: string[] = [],
): Promise<string> {
  const runRoot = runRootPath(podletDir, runId);
  const workspaceRoot = join(runRoot, "workspace");

  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(join(runRoot, "artifacts"), { recursive: true });
  await mkdir(join(runRoot, "skills"), { recursive: true });

  for (const name of allowedSkills) {
    const target = join(podletDir, "skills", name);
    try {
      if (!(await stat(target)).isDirectory()) continue;
    } catch {
      continue; // skill not installed — nothing to link
    }
    await ensureSymlink(target, join(runRoot, "skills", name));
  }

  // Read-only input: r-x so it stays traversable, but nothing can be created
  // in it by the shell.
  try {
    await chmod(workspaceRoot, 0o555);
  } catch { /* best effort (filesystem may not support it) */ }

  return runRoot;
}

export class VirtualFileSystem {
  private readonly rootDir: string;
  private readonly runId: string;
  private readonly allowedSkills: string[];
  private serialQueue = new SerialQueue();

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

  constructor(
    rootDir: string,
    runId: string,
    _cwd?: string,
    skillmanager?: SkillsManager,
    skills: string[] = [],
  ) {
    this.rootDir = rootDir;
    this.runId = runId;
    void _cwd; // legacy: the run root is the cwd now
    this.allowedSkills = skills.filter(name => !skillmanager || !!skillmanager.availableSkills[name]);
  }

  // ---------------------------------------------------------------------------
  // Roots / context
  // ---------------------------------------------------------------------------

  get virtualContext(): VirtualContext {
    return {
      podletDir: this.rootDir,
      runId: this.runId,
      allowedSkills: this.allowedSkills,
    };
  }

  /** `<podletDir>/runs/<runId>` — the shell cwd. */
  get runRoot(): string {
    return runRootPath(this.rootDir, this.runId);
  }

  get allowedSkillNames(): string[] {
    return [...this.allowedSkills];
  }

  /** Resolve a relative virtual path to its real absolute path. */
  resolveVirtual(rel: string): string {
    return resolveVirtual(rel, this.virtualContext);
  }

  /** Create the per-run layout. Safe to call repeatedly. */
  async ensureRunRoot(): Promise<string> {
    return ensureRunRoot(this.rootDir, this.runId, this.allowedSkills);
  }

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  async upload(input: FileUpload, dest: VirtualRootName = "workspace"): Promise<FileResponse[]> {
    const destRoot = resolveWithin(rootFor(dest, this.virtualContext), ".");
    await mkdir(destRoot, { recursive: true });
    // Make the destination writable for the duration of the upload; uploads into
    // the workspace are re-locked at the end.
    try {
      await chmod(destRoot, 0o755);
    } catch { /* best effort */ }

    const writeInto = async (name: string, content: string | ArrayBuffer | Uint8Array) => {
      const target = resolveWithin(destRoot, name);
      try {
        await chmod(target, 0o644);
      } catch { /* new file */ }
      await Bun.write(target, content);
      return target;
    };

    const results = await Promise.all(input.files.map(async (file) => {
      const buffer = await file.arrayBuffer();
      // Only the last path component of a client-supplied name is ever used.
      const safeName = basename(file.name.replace(/\\/g, "/"));
      if (!safeName || safeName === "." || safeName === "..") return null;

      const isPdf = extname(safeName).toLowerCase() === ".pdf";

      let storedFilename: string;
      let fileType: "text" | "image" = "text";

      if (isPdf) {
        // Keep the original PDF bytes in the workspace. Rendering happens later,
        // when the model message is constructed.
        storedFilename = safeName;
        await writeInto(storedFilename, buffer);
      } else {
        const resolved = await this.resolveAttachment(buffer, file.type, safeName);
        if (!resolved) {
          console.warn(`Skipping unsupported file: ${safeName} (${file.type})`);
          return null;
        }

        if (resolved.type === "image") {
          storedFilename = safeName;
          fileType = "image";
          await writeInto(storedFilename, buffer);
        } else if (resolved.type === "text") {
          storedFilename = safeName;
          await writeInto(storedFilename, resolved.content);
        } else {
          storedFilename = safeName.replace(/\.[^.]+$/, ".md");
          await writeInto(storedFilename, resolved.content);
        }
      }

      const vpath = `${dest}/${storedFilename}`;
      return { name: storedFilename, vpath, id: vpath, type: fileType };
    }));

    // Workspace is the read-only input root.
    if (dest === "workspace") {
      await Promise.all(results.filter(r => r !== null).map(async (r) => {
        try {
          const info = await stat(join(destRoot, r!.name));
          await chmod(join(destRoot, r!.name), info.isDirectory() ? 0o555 : 0o444);
        } catch { /* best effort */ }
      }));
      try {
        await chmod(destRoot, 0o555);
      } catch { /* best effort */ }
    }

    return results.filter((r): r is FileResponse => r !== null);
  }

  // ---------------------------------------------------------------------------
  // List files
  // ---------------------------------------------------------------------------

  async listFiles(root: VirtualRootName): Promise<FileResponse[]> {
    const realPath = rootFor(root, this.virtualContext);

    let files: string[];
    try {
      const entries = await readdir(realPath, { recursive: true, withFileTypes: true });
      files = entries
        .filter(entry => entry.isFile())
        .map(entry => {
          const relative = entry.parentPath.slice(realPath.length).replace(/^\//, '');
          return relative ? `${relative}/${entry.name}` : entry.name;
        });
    } catch {
      return [];
    }

    return this.filterFiles(files).sort().map(file => {
      const vpath = `${root}/${file}`;
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file);
      return {
        name: file,
        vpath,
        id: vpath,
        type: isImage ? 'image' as const : 'text' as const,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Error sanitising
  // ---------------------------------------------------------------------------

  /**
   * Replace real filesystem paths in a string with their virtual equivalents.
   * Safe for error messages and JSON output — short OS strings, not file content.
   */
  public sanitizeErrorMessage(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);

    const rawReplacements: [string, string][] = [
      [join(this.runRoot, "workspace"), "workspace"],
      [join(this.runRoot, "artifacts"), "artifacts"],
      [join(this.runRoot, "skills"), "skills"],
      [join(this.rootDir, "skills"), "skills"],
      [this.runRoot, "."],
      [this.rootDir, ""],
    ];
    const replacements = [...rawReplacements].sort((a, b) => b[0].length - a[0].length);

    let result = msg;
    for (const [realRoot, virtualRoot] of replacements) {
      result = result.split(realRoot + sep).join(virtualRoot ? virtualRoot + "/" : "");
      result = result.split(realRoot).join(virtualRoot || ".");
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Returns a BunFile instance. Does not read until .text()/.blob() is called.
   */
  public getFile(vpath: string) {
    return Bun.file(this.resolveVirtual(vpath));
  }

  public async readFileText(vpath: string): Promise<string> {
    return this.getFile(vpath).text();
  }

  /**
   * Read file text by relative path (used by tools that receive relative paths).
   */
  public async readFileTextByVPath(vpath: string): Promise<string> {
    try {
      const realPath = this.resolveVirtual(vpath);
      const file = Bun.file(realPath);
      if (!(await file.exists())) throw new Error('File not found: ' + vpath);
      return file.text();
    } catch (err) {
      throw new Error(this.sanitizeErrorMessage(err));
    }
  }

  // ---------------------------------------------------------------------------
  // Write / update / delete
  // ---------------------------------------------------------------------------

  private assertWritableRoot(vpath: string, action: string): void {
    const { root } = splitVirtual(vpath);
    if (root !== "artifacts") {
      throw new Error(
        `Cannot ${action} to "${root}/" — it is read-only. Use artifacts/ for anything you produce.`,
      );
    }
  }

  public async updateFile(vpath: string, content: string | Blob | ArrayBuffer): Promise<void> {
    this.assertWritableRoot(vpath, "write");
    const realPath = this.resolveVirtual(vpath);
    await Bun.write(realPath, content);
  }

  public async deleteFile(vpath: string): Promise<void> {
    this.assertWritableRoot(vpath, "delete from");
    const realPath = this.resolveVirtual(vpath);
    await unlink(realPath);
  }

  /**
   * Atomically write content to a relative path.
   * Uses a temp file + rename. Serializes writes via a queue.
   * Refuses read-only roots.
   */
  public async atomicWrite(vpath: string, content: string): Promise<void> {
    this.assertWritableRoot(vpath, "write");

    return this.serialQueue.enqueue(async () => {
      const realPath = this.resolveVirtual(vpath);
      const dir = dirname(realPath);
      await mkdir(dir, { recursive: true });
      const tmpPath = `${realPath}.tmp.${Date.now()}`;
      await Bun.write(tmpPath, content);
      await rename(tmpPath, realPath);
    });
  }

  // ---------------------------------------------------------------------------
  // Staging
  // ---------------------------------------------------------------------------

  /**
   * Copy files from workspace/ to artifacts/, preserving directory structure.
   * Skips files that already exist in artifacts/.
   */
  public async stageFiles(vpaths: string[]): Promise<{ staged: string[]; skipped: string[]; errors: string[] }> {
    const staged: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const vpath of vpaths) {
      try {
        const { root, rest } = splitVirtual(vpath);
        if (root !== "workspace") {
          errors.push(`Not a workspace/ path: ${vpath}`);
          continue;
        }

        const artifactVPath = `artifacts/${rest}`;
        const srcReal = this.resolveVirtual(vpath);
        const dstReal = this.resolveVirtual(artifactVPath);
        const srcInfo = await stat(srcReal);

        if (srcInfo.isDirectory()) {
          const entries = await readdir(srcReal, { recursive: true, withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const entryRel = entry.parentPath.slice(srcReal.length).replace(/^\//, '');
            const entryFile = entryRel ? `${entryRel}/${entry.name}` : entry.name;
            const dstFile = join(dstReal, entryFile);
            const dstVPath = `artifacts/${rest ? rest + '/' : ''}${entryFile}`;

            if (await Bun.file(dstFile).exists()) {
              skipped.push(dstVPath);
            } else {
              await mkdir(dirname(dstFile), { recursive: true });
              await copyFile(join(entry.parentPath, entry.name), dstFile);
              staged.push(dstVPath);
            }
          }
        } else {
          if (await Bun.file(dstReal).exists()) {
            skipped.push(artifactVPath);
          } else {
            await mkdir(dirname(dstReal), { recursive: true });
            await copyFile(srcReal, dstReal);
            staged.push(artifactVPath);
          }
        }
      } catch (err) {
        errors.push(`${vpath}: ${this.sanitizeErrorMessage(err)}`);
      }
    }

    return { staged, skipped, errors };
  }

  // ---------------------------------------------------------------------------
  // Filesystem tree / context
  // ---------------------------------------------------------------------------

  private async getRootTree(root: VirtualRootName): Promise<string> {
    const realPath = rootFor(root, this.virtualContext);
    const label = `${root}/`;

    let files: string[];
    try {
      files = (await readdir(realPath, { recursive: true })) as string[];
    } catch {
      return `${label}\n  (empty)`;
    }

    const filtered = this.filterFiles(files.map(f => String(f)));
    if (filtered.length === 0) return `${label}\n  (empty)`;
    return `${label}\n` + filtered.sort().map(f => `  ${root}/${f}`).join("\n");
  }

  public async getContextTree(): Promise<string> {
    const trees = await Promise.all(
      (["workspace", "artifacts"] as const).map(s => this.getRootTree(s)),
    );
    const tree = trees.join("\n\n");

    return `
<filesystem_context>
## Virtual Filesystem
You operate inside a per-run directory. The tree below is **exhaustive and complete** — it contains every file that exists. There are no hidden files, no other directories, and no external sources to check.

**ABSOLUTE RULES — never violated under any circumstance:**
1. A file not listed in the tree below **does not exist**. Do not reference it, guess its path, or attempt to access it.
2. All paths are **relative to your run root** (your working directory) and MUST begin with \`workspace/\`, \`artifacts/\` or \`skills/\`. No exceptions.
3. Absolute paths (\`/etc\`, \`~\`, \`../\`) are rejected.
4. \`workspace/\` is **read-only** input. Never write to it.
5. \`artifacts/\` is your **write space**. All files you produce go here.
6. \`skills/\` is **read-only** and contains only the skills assigned to you.
7. To look at an image (.png, .jpg, .jpeg, .webp, .gif), use see_image. read_file cannot read images.

**If a file you need does not appear in the tree: stop and tell the user. Do not speculate.**

## Tool usage — mandatory rules

| Goal                              | Tool to use       | NEVER use                          |
|-----------------------------------|-------------------|------------------------------------|
| Read a file                       | read_file         | cat, head, tail, grep, shell       |
| Look at an image (.png .jpg .jpeg .webp .gif) | see_image | read_file, execute_shell, base64 in a text file |
| Create or fully overwrite a file  | write_file        | echo, tee, printf, heredoc, shell  |
| Edit part of an existing file     | apply_diff        | sed, awk, patch, shell             |
| Copy workspace file for editing   | stage_files       | cp via shell                       |
| Build, test, install, git         | execute_shell     | —                                  |

## Roots
- **workspace/** — User-provided input files. Read-only source of truth.
- **artifacts/** — Your working output space. Write all produced files here.
- **skills/** — Read-only skill instructions.
- Images are attached to the conversation after a see_image call — the receipt you get back is metadata only, so do not try to read the pixels back out of it.

## Path format
Paths are relative and start with a root segment.
- Correct:   \`artifacts/report.md\`, \`workspace/input.txt\`, \`skills/pdf-tools/SKILL.md\`
- Incorrect: \`/artifacts/report.md\` ← leading slash, will be rejected

## Complete File Tree
${tree}
</filesystem_context>`.trim();
  }

  // ---------------------------------------------------------------------------
  // File filtering
  // ---------------------------------------------------------------------------

  private filterFiles(files: string[]): string[] {
    return files.filter(file => {
      const parts = file.split(/\/|\\/);
      if (parts.some(part => this.ignoreList.has(part))) return false;
      if (this.ignoreExtensions.has(extname(file))) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Attachment resolution
  // ---------------------------------------------------------------------------

  async getAttachmentCategory(
    mime: string,
    filename: string,
    buffer: ArrayBuffer
  ): Promise<'image' | 'text' | 'document' | null> {
    if (mime.startsWith('image/')) return 'image';
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return 'text';
    } catch {
      return null;
    }
  }

  astToMarkdown(nodes: OfficeContentNode[]): string {
    return nodes.map(node => {
      switch (node.type) {
        case 'heading': {
          const meta = node.metadata as HeadingMetadata | undefined;
          const level = '#'.repeat(meta?.level ?? 1);
          return `${level} ${node.text}`;
        }
        case 'paragraph':
          return node.text;
        case 'list': {
          const meta = node.metadata as ListMetadata | undefined;
          const prefix = meta?.listType === 'ordered' ? `${(meta.itemIndex ?? 0) + 1}.` : '-';
          const indent = '  '.repeat(meta?.indentation ?? 0);
          return `${indent}${prefix} ${node.text}`;
        }
        case 'table': {
          const rows = (node.children ?? [])
            .filter(r => r.type === 'row')
            .map(row =>
              (row.children ?? [])
                .filter(c => c.type === 'cell')
                .map(cell => (cell.text ?? '').replace(/\|/g, '\\|').trim())
                .join(' | ')
            );
          if (rows.length === 0) return '';
          const separator = rows[0].split(' | ').map(() => '---').join(' | ');
          return [
            `| ${rows[0]} |`,
            `| ${separator} |`,
            ...rows.slice(1).map(r => `| ${r} |`),
          ].join('\n');
        }
        case 'note':
          return `> ${node.text}`;
        default:
          return node.text ?? '';
      }
    })
      .filter(Boolean)
      .join('\n\n');
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
    const category = await this.getAttachmentCategory(mime, filename, buffer);
    switch (category) {
      case 'image': return { type: 'image', content: buffer };
      case 'text': return { type: 'text', content: new TextDecoder().decode(buffer) };
      case 'document': {
        const ast = await parseOffice(Buffer.from(buffer));
        return { type: 'text', content: this.astToMarkdown(ast.content) };
      }
      case null: return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Content block generation
  // ---------------------------------------------------------------------------

  async generateContentBlock(
    fileIDs: string[],
    message: ChatCompletionUserMessageParam
  ): Promise<ChatCompletionUserMessageParam> {
    const parts: ChatCompletionContentPart[] = [];

    for (const fileID of fileIDs) {
      const vpath = fileID;
      const file = this.getFile(vpath);

      if (extname(vpath).toLowerCase() === ".pdf") {
        const loadingTask = getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
          useSystemFonts: true,
          isEvalSupported: false,
        });
        const pdf = await loadingTask.promise;

        try {
          if (pdf.numPages > MAX_PDF_PAGES) {
            throw new Error(
              `PDF ${vpath} has ${pdf.numPages} pages; the maximum supported is ${MAX_PDF_PAGES}.`,
            );
          }

          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = createCanvas(
              Math.ceil(viewport.width),
              Math.ceil(viewport.height),
            );

            try {
              const context = canvas.getContext("2d");
              await page.render({
                canvasContext: context as unknown as CanvasRenderingContext2D,
                viewport,
              }).promise;

              const png = canvas.toBuffer("image/png");
              parts.push({
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${png.toString("base64")}`,
                },
              });
            } finally {
              page.cleanup();
              canvas.width = 0;
              canvas.height = 0;
            }
          }
        } finally {
          await pdf.destroy();
        }

        continue;
      }

      if (file.type.startsWith("image/")) {
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
          },
        });
      } else {
        parts.push({ type: "text", text: await file.text() });
      }
    }

    const initContent: ChatCompletionContentPart[] = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: message.content as string }];

    return { role: 'user', content: [...parts, ...initContent] };
  }

  // ---------------------------------------------------------------------------
  // Cleanup / export
  // ---------------------------------------------------------------------------

  async deleteFolder(runid: string) {
    await rm(runRootPath(this.rootDir, runid), { recursive: true, force: true });
    // Legacy layout from before the run-root refactor.
    await rm(join(this.rootDir, "artifacts", runid), { recursive: true, force: true });
  }

  public async streamFolderAsZip(vpath: string): Promise<Response> {
    const realPath = this.resolveVirtual(vpath);
    const info = await stat(realPath);
    if (!info.isDirectory()) throw new Error('Not a directory');

    const entries = await readdir(realPath, { recursive: true, withFileTypes: true });
    const files: Record<string, Uint8Array> = {};

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relative = entry.parentPath.slice(realPath.length).replace(/^\//, '');
      const filePath = relative ? `${relative}/${entry.name}` : entry.name;
      const content = await Bun.file(join(realPath, filePath)).arrayBuffer();
      files[filePath] = new Uint8Array(content);
    }

    const zipped = fflate.zipSync(files);
    const folderName = vpath.split('/').filter(Boolean).pop() || 'folder';

    return new Response(zipped, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${folderName}.zip"`,
      },
    });
  }
}