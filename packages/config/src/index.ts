import { join } from 'path';
import { homedir } from 'os';
import type { AppConfig, ConfigFile } from '@podlet/types';

async function loadConfig(): Promise<AppConfig> {
  const podletDir = join(homedir(), '.podlet');
  const configPath = join(podletDir, 'config.json');

  let configFile: ConfigFile = {};

  try {
    const file = Bun.file(configPath);
    if (await file.exists()) {
      configFile = await file.json();
    }
  } catch {
    // Fallback to defaults if file is missing or invalid JSON
  }

  const port = configFile.server?.port ?? 3000;
  const pythonPort = configFile.server?.pythonPort ?? 8000;
  const webPort = configFile.server?.webPort ?? 3002;
  let host = configFile.server?.host ?? '127.0.0.1';
  const dbName = configFile.database?.path ?? 'podlet.db';
  const safemode = configFile.features?.safemode ?? false;
  const dbPath = join(podletDir, dbName);

  const llmApiUrl = process.env.LLM_SERVICE_HOST
    ? `http://${process.env.LLM_SERVICE_HOST}:${pythonPort}`
    : `http://localhost:${pythonPort}`;

  let corsOrigin = `http://localhost:${webPort}`;

  // Docker overlay: override settings for container runtime without modifying config.json
  if (process.env.PODLET_DOCKER === '1') {
    host = '0.0.0.0';
    corsOrigin = 'http://localhost:3002';
  }

  return {
    podletDir,
    dbName,
    dbPath,
    llmApiUrl,
    port,
    host,
    pythonPort,
    webPort,
    corsOrigin,
    safemode,
  };
}

export const prodConfig: AppConfig = await loadConfig();
