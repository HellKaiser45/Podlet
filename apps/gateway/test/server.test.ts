import { join } from 'path';
import { AppConfig } from '../src/types';
import { cleanup, createServer } from '../src/server';
import AppContainer from '../src/runtime';

const TEST_ROOT = join(import.meta.dir, 'seed', '.podlet')

export const testConfig: AppConfig = {
  podeletDir: TEST_ROOT,
  dbName: ':memory:',
  llmApiUrl: 'http://localhost:8000',
  appPort: 3000,
  enableWatchers: false,
  safemode: false,
}

export const testConfigHill: AppConfig = {
  podeletDir: TEST_ROOT,
  dbName: ':memory:',
  llmApiUrl: 'http://localhost:8000',
  appPort: 3001,
  enableWatchers: false,
  safemode: true,
}

export async function runServer(config: AppConfig) {
  const container = new AppContainer(config)
  await container.init()

  const app = createServer(container)

  process.on("SIGINT", () => cleanup(container));
  process.on("SIGTERM", () => cleanup(container));

  console.log(`🦊 Elysia test server running at http://localhost:${config.appPort}`)

  return app
}
