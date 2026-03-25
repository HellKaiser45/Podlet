import { join } from 'node:path'
import { mkdir } from "node:fs/promises";


export default async function createfilesystem(path: string) {
  await mkdir(path, { recursive: true })
  await mkdir(join(path, "agents"), { recursive: true })
  await mkdir(join(path, 'prompts'), { recursive: true })
  await mkdir(join(path, 'skills'), { recursive: true })

  const mcpsfiles = Bun.file(join(path, 'mcp.json'))
  const envfile = Bun.file(join(path, '.env'))
  const modelsfiles = Bun.file(join(path, 'models.json'))
  const configfiles = Bun.file(join(path, 'config.json'))

  if (!await envfile.exists()) {
    await envfile.write('OPENAI_API_KEY=\nANTHROPIC_API_KEY=\n');
  }

  if (!await mcpsfiles.exists()) {
    mcpsfiles.write(JSON.stringify({
      mcpServers: {}
    }, null, 2))
  }
  if (!await configfiles.exists()) {
    configfiles.write(JSON.stringify({
      server: { port: 3000, host: "127.0.0.1", cors_enabled: true },
      database: { path: "podelet.db" },
      logging: { level: "info" },
      features: { hil_enabled: true, max_concurrent_agents: 5 }
    }, null, 2))
  }
  if (!await modelsfiles.exists()) {
    modelsfiles.write(JSON.stringify({
      fast: { provider: "openai", model: "gpt-4o-mini", temperature: 0.7 },
      smart: { provider: "anthropic", model: "claude-sonnet-4" }

    }, null, 2))
  }
}

