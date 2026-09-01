import { spawn, spawnSync } from 'child_process';
import { existsSync, cpSync, rmSync, renameSync } from 'node:fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { join } from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '..');
const podletDir = path.join(os.homedir(), '.podlet');
const isWin = process.platform === 'win32';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ── Helpers ──────────────────────────────────────────────

function run(cmd: string, args: string[], opts: Record<string, any> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command "${cmd} ${args.join(' ')}" exited with code ${code}`));
    });
  });
}

function getOutput(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  return (r.stdout || '').trim();
}

function ask(question: string, def: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(def ? `${question} [${def}]: ` : `${question}: `, (ans) => {
      resolve((ans || '').trim() || def);
    });
  });
}

async function askYesNo(question: string, def: boolean): Promise<boolean> {
  const label = def ? '(Y/n)' : '(y/N)';
  const ans = await ask(`${question} ${label}`, def ? 'y' : 'n');
  return ['y', 'yes'].includes(ans.toLowerCase());
}


// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║          PODLET Setup Wizard           ║');
  console.log('╚════════════════════════════════════════╝\n');

  // ── Prerequisites ────────────────────────────────────
  try {
    const v = getOutput('bun', ['-v']);
    console.log(`  [ok] Bun ${v}`);
  } catch {
    console.error('  [!] Bun not found. Install: https://bun.sh');
    process.exit(1);
  }

  const pyCmd = isWin ? 'python' : 'python3';
  try {
    const raw = getOutput(pyCmd, ['--version']);
    const m = raw.match(/(\d+)\.(\d+)/);
    if (!m || +m[1] < 3 || (+m[1] === 3 && +m[2] < 10)) {
      throw new Error(`Python >= 3.10 required, got: ${raw}`);
    }
    console.log(`  [ok] ${raw}`);
  } catch (e: any) {
    console.error(`  [!] ${e.message || 'Python 3.10+ not found.'} Install: https://www.python.org`);
    process.exit(1);
  }

  // ── JS deps ──────────────────────────────────────────
  console.log('\n  Installing JS dependencies...');
  await run('bun', ['install'], { cwd: repoRoot });

  // ── Python venv ──────────────────────────────────────
  console.log('  Setting up Python virtual environment...');
  const venvDir = path.join(repoRoot, 'agent_core_py', '.venv');
  if (!existsSync(venvDir)) {
    await run(pyCmd, ['-m', 'venv', venvDir], { cwd: repoRoot });
  }
  const pip = isWin
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');
  await run(pip, ['install', '-r', path.join(repoRoot, 'agent_core_py', 'requirements.txt')], { cwd: repoRoot });

  // ── Existing config check ────────────────────────────
  if (existsSync(path.join(podletDir, 'config.json'))) {
    const overwrite = await askYesNo(
      `  Configuration already exists at ${podletDir}. Overwrite?`, false,
    );
    if (!overwrite) {
      console.log('  Keeping existing configuration. Skipping config generation.');
      rl.close();
      console.log('\n  [ok] Setup complete (existing config preserved).\n');
      return;
    }
  }

  // --Copy of the current template .podlet ---

  rmSync(podletDir, { recursive: true, force: true });
  cpSync(join(repoRoot, ".podlet"), podletDir, { recursive: true })
  renameSync(join(podletDir, '.env.example'), join(podletDir, '.env'))


  // ── Done ─────────────────────────────────────────────
  console.log('\n  [ok] Podlet setup complete!\n');
  console.log('  Configuration: ' + podletDir);
  console.log('');
  console.log('api keys in .env')
  console.log('your mcps config in mcp.json')
  console.log("add your skills in the skill folder")
  console.log("create your agents using the agent folder or directly in the interface")


  console.log('');
  rl.close();
}

main().catch((err) => {
  console.error('\n  Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
