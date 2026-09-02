import { prodConfig } from '@podlet/config';
import AppContainer from './runtime';
import { createServer, cleanup } from './server';

console.log(`[Config] podletDir: ${prodConfig.podletDir}`);
console.log(`[Config] DB path: ${prodConfig.dbPath}`);
console.log(`[Config] port: ${prodConfig.port}, host: ${prodConfig.host}`);
console.log(`[Config] llmApiUrl: ${prodConfig.llmApiUrl}`);
console.log(`[Config] corsOrigin: ${prodConfig.corsOrigin}`);

const container = new AppContainer(prodConfig)
await container.init()

const runCount = await container.historyManager.getAllRuns();
console.log(`[DB] Found ${runCount.length} conversations in database`);

export const app = await createServer(container)
export type App = typeof app

process.on("SIGINT", () => cleanup(container));
process.on("SIGTERM", () => cleanup(container));

console.log(`🦊 Elysia server running at http://localhost:${prodConfig.port}`);
