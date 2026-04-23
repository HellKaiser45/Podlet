import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

const isWin = process.platform === 'win32';
const repoRoot = path.resolve(import.meta.dir, '..');
const podletDir = path.join(os.homedir(), '.podlet');

// ── Read config once ─────────────────────────────────────

let config: any = {};
try {
  config = JSON.parse(readFileSync(path.join(podletDir, 'config.json'), 'utf8'));
} catch {
  console.log('  [!] Could not read config.json, using defaults.');
}

const gatewayPort = config.server?.port ?? 3000;
const pythonPort  = config.server?.pythonPort ?? 8000;
const webPort     = config.server?.webPort ?? 3002;
const host        = config.server?.host ?? '127.0.0.1';

// ── Track children ───────────────────────────────────────

const children: ReturnType<typeof spawn>[] = [];

function start(name: string, cmd: string, args: string[], opts: Record<string, any> = {}) {
  const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
  children.push(proc);
  proc.on('error', (err) => console.error(`  [${name}] Failed: ${err.message}`));
  proc.on('exit', (code) => {
    if (code && code !== 0) console.log(`  [${name}] Exited with code ${code}`);
  });
  return proc;
}

// ── Graceful shutdown ────────────────────────────────────

function shutdown() {
  console.log('\n  Shutting down...');
  for (const p of children) {
    try { p.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (isWin) process.on('SIGHUP', shutdown);

// ── Start services ───────────────────────────────────────

async function main() {
  console.log('');
  console.log('  ╔════════════════════════════════════════╗');
  console.log('  ║          Starting Podlet               ║');
  console.log('  ╚════════════════════════════════════════╝');
  console.log('');

  // 1. Python / FastAPI backend
  const venvDir = path.join(repoRoot, 'agent_core_py', '.venv');
  if (!existsSync(venvDir)) {
    console.error('  [!] Python venv not found. Run "bun run init" first.');
    process.exit(1);
  }

  const pythonBin = isWin
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  console.log('  [python] Starting on ' + host + ':' + pythonPort);
  start('python', pythonBin, [
    '-m', 'uvicorn', 'main:app',
    '--host', host,
    '--port', String(pythonPort),
  ], { cwd: path.join(repoRoot, 'agent_core_py') });

  // Wait for Python to bind
  await new Promise((r) => setTimeout(r, 2000));

  // 2. Gateway (Elysia/Bun)
  console.log('  [gateway] Starting on ' + host + ':' + gatewayPort);
  start('gateway', 'bun', [
    'run', path.join(repoRoot, 'apps', 'gateway', 'src', 'start_prod_server.ts'),
  ], {
    cwd: repoRoot,
    env: { ...process.env, APP_PORT: String(gatewayPort) },
  });

  await new Promise((r) => setTimeout(r, 1000));

  // 3. Web UI (SolidJS / Vite dev server)
  console.log('  [web] Starting on http://localhost:' + webPort);
  start('web', 'bun', [
    'run', '--filter', 'web', 'dev',
  ], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(webPort) },
  });

  console.log('');
  console.log('  ─────────────────────────────────────────');
  console.log('  Gateway:    http://localhost:' + gatewayPort);
  console.log('  Python LLM: http://localhost:' + pythonPort);
  console.log('  Web UI:     http://localhost:' + webPort);
  console.log('  ─────────────────────────────────────────');
  console.log('  Press Ctrl+C to stop all services.');
  console.log('');
}

main().catch((err) => {
  console.error('  Failed to start:', err.message);
  shutdown();
});
