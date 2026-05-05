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

  let pythonPort = configFile.server?.pythonPort ?? 8000;
  let host = configFile.server?.host ?? '127.0.0.1';
  const appPort = configFile.server?.port ?? 3000;
  const webPort = configFile.server?.webPort ?? 3002;
  const dbName = configFile.database?.path ?? 'podlet.db';
  const logLevel = configFile.logging?.level ?? 'info';
  const maxConcurrentAgents = configFile.features?.max_concurrent_agents ?? 5;
  const safemode = configFile.features?.safemode ?? false;

  let docker = {
    enabled: configFile.docker?.enabled ?? false,
    llmServiceHost: configFile.docker?.llmServiceHost ?? 'localhost',
    staticFrontend: configFile.docker?.staticFrontend ?? false,
  };

  let exposedPort = configFile.server?.exposedPort ?? webPort;
  const llmApiUrl = `http://${docker.llmServiceHost}:${pythonPort}`;
  const corsOrigin = configFile.features?.cors_origin ?? ('http://localhost:' + exposedPort);

  // Docker overlay: override settings for container runtime without modifying config.json
  const isDocker = process.env.PODLET_DOCKER === '1';
  if (isDocker) {
    host = '0.0.0.0';
    docker.enabled = true;
    docker.llmServiceHost = process.env.LLM_SERVICE_HOST || 'agent-core';
    docker.staticFrontend = true;
  }

  // Recompute derived values if Docker overrides changed them
  const finalLLmApiUrl = isDocker
    ? `http://${docker.llmServiceHost}:${pythonPort}`
    : llmApiUrl;
  const finalCorsOrigin = isDocker
    ? ('http://localhost:' + exposedPort)
    : corsOrigin;

  return {
    podeletDir: podeletDir,
    dbName,
    llmApiUrl: finalLLmApiUrl,
    appPort,
    exposedPort,
    enableWatchers: true,
    safemode,
    pythonPort,
    webPort,
    logLevel,
    maxConcurrentAgents,
    corsOrigin: finalCorsOrigin,
    host,
    docker,
  };
}

export const prodConfig: AppConfig = await loadConfig();
