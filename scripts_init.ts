import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, symlinkSync, cpSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

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

async function askSecret(question: string): Promise<string> {
  return await ask(question, '');
}

// ── Provider defaults ────────────────────────────────────

const PROVIDER_DEFAULTS: Record<string, { model: string; url?: string }> = {
  openai:     { model: 'gpt-4o-mini' },
  anthropic:  { model: 'claude-sonnet-4' },
  openrouter: { model: 'google/gemma-4-31b-it' },
  zai:        { model: 'GLM-5.1', url: 'https://api.z.ai/api/coding/paas/v4' },
  ollama:     { model: 'llama3.2', url: 'http://localhost:11434/v1' },
  gemini:     { model: 'gemini-2.0-flash-exp' },
};

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

  // ── Prompts ──────────────────────────────────────────
  console.log('\n  Configuration\n  ─────────────');

  const gatewayPort  = Number(await ask('Gateway port', '3000'));
  const pythonPort   = Number(await ask('Python backend port', '8000'));
  const webPort      = Number(await ask('Web UI port', '3002'));
  const hilEnabled   = await askYesNo('Enable Human-in-the-Loop (HIL)', true);
  const maxAgents    = Number(await ask('Max concurrent agents', '5'));

  // ── LLM providers ────────────────────────────────────
  interface ProviderEntry { provider: string; model: string; base_url?: string; envVar: string; apiKey: string }
  const providers: ProviderEntry[] = [];

  if (await askYesNo('Configure LLM providers now?', true)) {
    const selected = (await ask(
      'Providers (comma-separated): openai, anthropic, openrouter, zai, ollama, gemini',
      'openai',
    )).split(',').map(s => s.trim().toLowerCase());

    for (const p of selected) {
      const def = PROVIDER_DEFAULTS[p] || { model: 'unknown' };
      const model   = await ask(`  Model for ${p}`, def.model);
      const baseUrl = await ask(`  Base URL for ${p} (empty = default)`, def.url || '');
      const envVar  = await ask(`  API key env var for ${p}`, `${p.toUpperCase()}_API_KEY`);
      const apiKey  = await askSecret(`  API key for ${p}`);
      providers.push({ provider: p, model, ...(baseUrl ? { base_url: baseUrl } : {}), envVar, apiKey });
    }
  }

  // ── MCP servers ──────────────────────────────────────
  let mcpDefault = false;
  if (await askYesNo('Configure MCP servers now?', true)) {
    mcpDefault = await askYesNo('Include default MCP servers (context7, duckduckgo-search)', true);
  }

  // ── Write config files ───────────────────────────────
  console.log('\n  Writing configuration...');
  mkdirSync(path.join(podletDir, 'agents'),  { recursive: true });
  mkdirSync(path.join(podletDir, 'prompts'), { recursive: true });

  // config.json
  writeFileSync(path.join(podletDir, 'config.json'), JSON.stringify({
    server:   { port: gatewayPort, host: '127.0.0.1', pythonPort, webPort, cors_enabled: true },
    database: { path: 'podlet.db' },
    logging:  { level: 'info' },
    features: { hil_enabled: hilEnabled, max_concurrent_agents: maxAgents, cors_origin: 'http://localhost:' + webPort },
  }, null, 2));

  // models.json
  const modelsJson: Record<string, any> = {};
  for (const p of providers) {
    const entry: Record<string, string> = { provider: p.provider, model: p.model };
    if (p.base_url) entry.base_url = p.base_url;
    modelsJson[p.provider] = entry;
  }
  if (providers.length > 0) {
    modelsJson['fast'] = { ...modelsJson[providers[0].provider] };
    modelsJson['smart'] = providers[1] ? { ...modelsJson[providers[1].provider] } : { ...modelsJson[providers[0].provider] };
  } else {
    modelsJson['fast'] = { provider: 'openai', model: 'gpt-4o-mini' };
    modelsJson['smart'] = { provider: 'openai', model: 'gpt-4o-mini' };
  }
  writeFileSync(path.join(podletDir, 'models.json'), JSON.stringify(modelsJson, null, 2));

  // .env
  const envLines = providers.map(p => p.envVar + '=' + p.apiKey).join('\n');
  writeFileSync(path.join(podletDir, '.env'), envLines + '\n');

  // mcp.json
  writeFileSync(path.join(podletDir, 'mcp.json'), JSON.stringify(mcpDefault ? {
    mcpServers: {
      'ddg-search': { command: 'uvx', args: ['duckduckgo-mcp-server'] },
      'context7':   { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
    },
  } : { mcpServers: {} }, null, 2));

  // ── Seed agents & prompts ────────────────────────────
  const seedAgents = path.join(repoRoot, '.podlet', 'agents');
  if (existsSync(seedAgents)) {
    for (const f of readdirSync(seedAgents)) {
      if (f.endsWith('.json')) {
        copyFileSync(path.join(seedAgents, f), path.join(podletDir, 'agents', f));
      }
    }
  }
  const seedPrompts = path.join(repoRoot, '.podlet', 'prompts');
  if (existsSync(seedPrompts)) {
    for (const f of readdirSync(seedPrompts)) {
      if (f.endsWith('.md')) {
        copyFileSync(path.join(seedPrompts, f), path.join(podletDir, 'prompts', f));
      }
    }
  }

  // ── Skills symlink (with Windows fallback) ───────────
  const skillsSrc  = path.join(repoRoot, '.podlet', 'skills');
  const skillsDest = path.join(podletDir, 'skills');
  if (existsSync(skillsSrc) && !existsSync(skillsDest)) {
    try {
      symlinkSync(skillsSrc, skillsDest, isWin ? 'junction' : 'dir');
    } catch {
      // Windows may require admin for symlinks -- fall back to recursive copy
      console.log('  Symlink failed, copying skills directory...');
      cpSync(skillsSrc, skillsDest, { recursive: true });
    }
  }

  rl.close();

  // ── Done ─────────────────────────────────────────────
  console.log('\n  [ok] Podlet setup complete!\n');
  console.log('  Configuration: ' + podletDir);
  console.log('');
  console.log('  Services:');
  console.log('    Gateway:    http://localhost:' + gatewayPort);
  console.log('    Python LLM: http://localhost:' + pythonPort);
  console.log('    Web UI:     http://localhost:' + webPort);
  console.log('');
  console.log('  Next steps:');
  console.log('    cd ' + repoRoot);
  console.log('    bun run start');
  console.log('');
}

main().catch((err) => {
  console.error('\n  Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
