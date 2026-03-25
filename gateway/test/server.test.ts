import { join } from 'path';
import { AppConfig } from '../src/types';
import { cleanup, createServer } from '../src/server';
import AppContainer from '../src/runtime';

const TEST_ROOT = join(import.meta.dir, 'seed', '.podlet')

const testConfig: AppConfig = {
  podeletDir: TEST_ROOT,
  dbName: ':memory:',
  llmApiUrl: 'http://localhost:8000',
  appPort: 3000,
  enableWatchers: false,
}

const container = new AppContainer(testConfig)
await container.init()

const app = createServer(container)
app.listen(container.initConfig.appPort)

process.on("SIGINT", () => cleanup(container));
process.on("SIGTERM", () => cleanup(container));

console.log(`🦊 Elysia test server running at http://localhost:${testConfig.appPort}`)

export default app
