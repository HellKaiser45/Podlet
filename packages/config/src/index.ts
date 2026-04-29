import { join } from 'path';
import { homedir } from 'os';
import type { AppConfig, ConfigFile } from '@podlet/types';

async function loadConfig(): Promise<AppConfig> {
  const podeletDir = join(homedir(), '.podlet');
  const configPath = join(podeletDir, 'config.json');

  let configFile: ConfigFile = {};

  try {
    const file = Bun.file(configPath);
    if (await file.exists()) {
      configFile = await file.json();
    }
  } catch {
    // Fallback to defaults if file is missing or invalid JSON
  }

  const pythonPort = configFile.server?.pythonPort ?? 8000;
  const host = configFile.server?.host ?? '127.0.0.1';
  const appPort = configFile.server?.port ?? 3000;
  const webPort = configFile.server?.webPort ?? 3002;
  const dbName = configFile.database?.path ?? 'podlet.db';
  const logLevel = configFile.logging?.level ?? 'info';
  const maxConcurrentAgents = configFile.features?.max_concurrent_agents ?? 5;
  const corsOrigin = configFile.features?.cors_origin ?? 'http://localhost:3002';
  const safemode = configFile.features?.safemode ?? false;

  return {
    podeletDir,
    dbName,
    llmApiUrl: process.env.LLM_API_URL ?? ('http://localhost:' + pythonPort),
    appPort,
    enableWatchers: true,
    safemode,
    pythonPort,
    webPort,
    logLevel,
    maxConcurrentAgents,
    corsOrigin,
    host,
  };
}

export const prodConfig: AppConfig = await loadConfig();
