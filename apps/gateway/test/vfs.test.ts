import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PathEscape,
  resolveVirtual,
  resolveWithin,
  rootFor,
  ensureRunRoot,
  VirtualFileSystem,
  type VirtualContext,
} from '../src/system/sandbox';

let podletDir: string;
let escapeDir: string;
let ctx: VirtualContext;
let vfs: VirtualFileSystem;

const runId = 'run-1';
const allowedSkills = ['pdf-tools'];

beforeAll(async () => {
  podletDir = await mkdtemp(join(tmpdir(), 'podlet-vfs-'));
  escapeDir = await mkdtemp(join(tmpdir(), 'podlet-escape-'));

  await mkdir(join(podletDir, 'skills', 'pdf-tools'), { recursive: true });
  await writeFile(
    join(podletDir, 'skills', 'pdf-tools', 'SKILL.md'),
    '---\nname: pdf-tools\ndescription: test skill\n---\n',
  );

  await ensureRunRoot(podletDir, runId, allowedSkills);

  // ensureRunRoot locks the per-run workspace to 555; unlock while fixtures are written.
  const workspaceRoot = join(podletDir, 'runs', runId, 'workspace');
  await chmod(workspaceRoot, 0o755);
  await writeFile(join(workspaceRoot, 'foo.txt'), 'workspace contents');
  await chmod(join(workspaceRoot, 'foo.txt'), 0o444);
  await chmod(workspaceRoot, 0o555);

  // A symlink planted inside artifacts that points outside the run root.
  const artifactsRoot = join(podletDir, 'runs', runId, 'artifacts');
  await symlink(escapeDir, join(artifactsRoot, 'evil'), 'junction');
  await writeFile(join(escapeDir, 'secret.txt'), 'secret');

  ctx = { podletDir, runId, allowedSkills };
  vfs = new VirtualFileSystem(podletDir, runId, { skills: allowedSkills });
});

afterAll(async () => {
  await chmod(join(podletDir, 'runs', runId, 'workspace'), 0o755).catch(() => { });
  await rm(podletDir, { recursive: true, force: true });
  await rm(escapeDir, { recursive: true, force: true });
});

describe('resolveVirtual traversal rejection', () => {
  test('rejects artifacts/../../etc/passwd', () => {
    expect(() => resolveVirtual('artifacts/../../etc/passwd', ctx)).toThrow(PathEscape);
  });

  test('rejects absolute /etc/passwd', () => {
    expect(() => resolveVirtual('/etc/passwd', ctx)).toThrow(PathEscape);
  });

  test('rejects a path with no known root segment', () => {
    expect(() => resolveVirtual('etc/passwd', ctx)).toThrow(PathEscape);
    expect(() => resolveVirtual('foo/bar.txt', ctx)).toThrow(PathEscape);
  });

  test('rejects a symlink inside artifacts that points outside', () => {
    expect(() => resolveVirtual('artifacts/evil/secret.txt', ctx)).toThrow(PathEscape);
  });

  test('rejects resolveWithin on an absolute path', () => {
    expect(() => resolveWithin(join(podletDir, 'runs', runId, 'artifacts'), '/etc/passwd'))
      .toThrow(PathEscape);
  });
});

describe('relative path routing', () => {
  test('artifacts/foo round-trips', async () => {
    const realArtifacts = join(await realpath(podletDir), 'runs', runId, 'artifacts');
    expect(resolveVirtual('artifacts/foo.txt', ctx)).toBe(join(realArtifacts, 'foo.txt'));

    await vfs.atomicWrite('artifacts/foo.txt', 'hello artifact');
    expect(await vfs.readFileText('artifacts/foo.txt')).toBe('hello artifact');

    const listed = await vfs.listFiles('artifacts');
    expect(listed.map(f => f.vpath)).toContain('artifacts/foo.txt');
    expect(listed.find(f => f.vpath === 'artifacts/foo.txt')?.id).toBe('artifacts/foo.txt');
  });

  test('workspace/foo resolves and is read-only at the app layer', async () => {
    const realWorkspace = join(await realpath(podletDir), 'runs', runId, 'workspace');
    expect(resolveVirtual('workspace/foo.txt', ctx)).toBe(join(realWorkspace, 'foo.txt'));
    expect(await vfs.readFileText('workspace/foo.txt')).toBe('workspace contents');

    await expect(vfs.updateFile('workspace/foo.txt', 'nope')).rejects.toThrow();
    await expect(vfs.atomicWrite('workspace/foo.txt', 'nope')).rejects.toThrow();
    await expect(vfs.deleteFile('workspace/foo.txt')).rejects.toThrow();
  });

  test('skills/ write is rejected', async () => {
    await expect(vfs.updateFile('skills/pdf-tools/SKILL.md', 'nope')).rejects.toThrow();
    await expect(vfs.atomicWrite('skills/pdf-tools/SKILL.md', 'nope')).rejects.toThrow();
    // And a skill that was not assigned to this run is not addressable at all.
    expect(() => resolveVirtual('skills/other-skill/SKILL.md', ctx)).toThrow(PathEscape);
  });

  test('ensureRunRoot creates artifacts/, a real per-run workspace/ and assigned skill links', async () => {
    const root = join(podletDir, 'runs', runId);
    expect(await vfs.ensureRunRoot()).toBe(root);

    const { stat, lstat, readdir: rd } = await import('node:fs/promises');
    expect((await stat(join(root, 'artifacts'))).isDirectory()).toBe(true);
    expect((await stat(join(root, 'workspace'))).isDirectory()).toBe(true);
    // ...a real directory, not a link to a shared global workspace.
    expect((await lstat(join(root, 'workspace'))).isSymbolicLink()).toBe(false);
    expect(await rd(join(root, 'skills'))).toEqual(allowedSkills);
  });
});

// ---------------------------------------------------------------------------
// Symlink at the FINAL path component.
//
// Checking only dirname(realpath) lets `artifacts/link` (a link to a host file
// or directory outside the root) through, which turns any read — and any write,
// since Bun.write follows symlinks — into host filesystem access.
// ---------------------------------------------------------------------------

describe('symlink containment at the final path component', () => {
  let artifactsRoot: string;
  let realArtifacts: string;
  let realWorkspace: string;

  beforeAll(async () => {
    artifactsRoot = join(podletDir, 'runs', runId, 'artifacts');
    realArtifacts = join(await realpath(podletDir), 'runs', runId, 'artifacts');
    realWorkspace = join(await realpath(podletDir), 'runs', runId, 'workspace');

    // --- artifacts/ fixtures ---------------------------------------------
    await mkdir(join(artifactsRoot, 'inner'), { recursive: true });
    await writeFile(join(artifactsRoot, 'inner', 'data.txt'), 'inside artifacts');

    // final component escapes the root
    await symlink(escapeDir, join(artifactsRoot, 'outdir'), 'junction');
    await symlink(join(escapeDir, 'secret.txt'), join(artifactsRoot, 'outfile'), 'junction');

    // final component stays inside the root — must keep working
    await symlink(join(artifactsRoot, 'inner'), join(artifactsRoot, 'inlink'), 'junction');

    // --- workspace/ fixtures ---------------------------------------------
    const workspaceRoot = join(podletDir, 'runs', runId, 'workspace');
    await chmod(workspaceRoot, 0o755);

    await mkdir(join(workspaceRoot, 'inner'), { recursive: true });
    await writeFile(join(workspaceRoot, 'inner', 'data.txt'), 'inside workspace');

    await symlink(escapeDir, join(workspaceRoot, 'outdir'), 'junction');
    await symlink(join(escapeDir, 'secret.txt'), join(workspaceRoot, 'outfile'), 'junction');
    await symlink(join(workspaceRoot, 'inner'), join(workspaceRoot, 'inlink'), 'junction');

    await chmod(workspaceRoot, 0o555);
  });

  test('artifacts/ final-component symlink pointing outside is rejected', () => {
    expect(() => resolveVirtual('artifacts/outdir', ctx)).toThrow(PathEscape);
    expect(() => resolveVirtual('artifacts/outfile', ctx)).toThrow(PathEscape);
    // ...and so is a read that walks through it, via both entry points.
    expect(() => resolveVirtual('artifacts/outdir/secret.txt', ctx)).toThrow(PathEscape);
    expect(() => vfs.resolveVirtual('artifacts/outfile')).toThrow(PathEscape);
  });

  test('workspace/ final-component symlink pointing outside is rejected', () => {
    expect(() => resolveVirtual('workspace/outdir', ctx)).toThrow(PathEscape);
    expect(() => resolveVirtual('workspace/outfile', ctx)).toThrow(PathEscape);
    expect(() => resolveVirtual('workspace/outdir/secret.txt', ctx)).toThrow(PathEscape);
  });

  test('artifacts/ final-component symlink pointing inside the root still resolves', () => {
    expect(resolveVirtual('artifacts/inlink', ctx)).toBe(join(realArtifacts, 'inner'));
    expect(resolveVirtual('artifacts/inlink/data.txt', ctx))
      .toBe(join(realArtifacts, 'inner', 'data.txt'));
  });

  test('workspace/ final-component symlink pointing inside the root still resolves', () => {
    expect(resolveVirtual('workspace/inlink', ctx)).toBe(join(realWorkspace, 'inner'));
    expect(resolveVirtual('workspace/inlink/data.txt', ctx))
      .toBe(join(realWorkspace, 'inner', 'data.txt'));
  });

  test('a write through a symlink that leaves the root is rejected', async () => {
    // Final component is the link itself.
    expect(() => resolveWithin(artifactsRoot, 'outfile')).toThrow(PathEscape);

    // ...and every write path goes through the same resolution.
    await expect(vfs.updateFile('artifacts/outfile', 'pwned')).rejects.toThrow(PathEscape);
    await expect(vfs.updateFile('artifacts/outdir/pwned.txt', 'pwned')).rejects.toThrow(PathEscape);
    await expect(vfs.atomicWrite('artifacts/outdir/pwned.txt', 'pwned')).rejects.toThrow(PathEscape);
    await expect(vfs.atomicWrite('artifacts/outfile', 'pwned')).rejects.toThrow(PathEscape);
  });
});

// ---------------------------------------------------------------------------
// Per-run isolation: one workspace and one artifacts per run. Two runs must
// never see each other's files, so neither root may be global.
// ---------------------------------------------------------------------------

describe('per-run workspace isolation', () => {
  const otherRunId = 'run-2';
  // Built inside beforeAll: this describe body runs at collection time, before
  // the file-level beforeAll has assigned podletDir.
  let ctxOther: VirtualContext;
  let realWorkspaceA: string;
  let realWorkspaceB: string;

  beforeAll(async () => {
    ctxOther = { podletDir, runId: otherRunId, allowedSkills };
    await ensureRunRoot(podletDir, otherRunId, allowedSkills);
    realWorkspaceA = join(await realpath(podletDir), 'runs', runId, 'workspace');
    realWorkspaceB = join(await realpath(podletDir), 'runs', otherRunId, 'workspace');

    for (const dir of [realWorkspaceA, realWorkspaceB]) {
      await chmod(dir, 0o755);
    }
    await writeFile(join(realWorkspaceA, 'shared.txt'), 'from run 1');
    await writeFile(join(realWorkspaceB, 'shared.txt'), 'from run 2');
    for (const dir of [realWorkspaceA, realWorkspaceB]) {
      await chmod(dir, 0o555);
    }
  });

  afterAll(async () => {
    for (const dir of [realWorkspaceA, realWorkspaceB]) {
      await chmod(dir, 0o755).catch(() => { });
    }
  });

  test('two runIds produce two different rootFor("workspace") paths', () => {
    const wsA = rootFor('workspace', ctx);
    const wsB = rootFor('workspace', ctxOther);

    expect(wsA).not.toBe(wsB);
    expect(wsA).toBe(join(podletDir, 'runs', runId, 'workspace'));
    expect(wsB).toBe(join(podletDir, 'runs', otherRunId, 'workspace'));
  });

  test('resolveVirtual("workspace/x") differs per run', () => {
    const a = resolveVirtual('workspace/shared.txt', ctx);
    const b = resolveVirtual('workspace/shared.txt', ctxOther);

    expect(a).not.toBe(b);
    expect(a).toBe(join(realWorkspaceA, 'shared.txt'));
    expect(b).toBe(join(realWorkspaceB, 'shared.txt'));
  });

  test('a file in run A workspace is not visible from run B workspace', async () => {
    await chmod(realWorkspaceA, 0o755);
    await writeFile(join(realWorkspaceA, 'only-in-a.txt'), 'A only');
    await chmod(realWorkspaceA, 0o555);

    expect(await Bun.file(resolveVirtual('workspace/only-in-a.txt', ctx)).exists()).toBe(true);
    expect(await Bun.file(resolveVirtual('workspace/only-in-a.txt', ctxOther)).exists()).toBe(false);
  });
});