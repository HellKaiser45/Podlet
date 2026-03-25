import { join } from 'path';
import type { AppConfig } from './types';
import AppContainer from './runtime';
import { createServer, cleanup } from './server';

const prodConfig: AppConfig = {
  podeletDir: join(Bun.env.HOME || Bun.env.USERPROFILE || '.', '.podlet'),
  dbName: 'podlet.db',
  llmApiUrl: 'http://localhost:8000',
  appPort: 3000,
  enableWatchers: true,
}

const container = new AppContainer(prodConfig)
await container.init()

const app = createServer(container)
app.listen(container.initConfig.appPort)

process.on("SIGINT", () => cleanup(container));
process.on("SIGTERM", () => cleanup(container));

console.log(`🦊 Elysia server running at http://localhost:${prodConfig.appPort}`);
