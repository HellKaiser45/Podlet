import { prodConfig } from '@podlet/config';
import AppContainer from './runtime';
import { createServer, cleanup } from './server';

// One failed run must emit RUN_ERROR to the client and leave the server
// serving: process death turns a single bad request into a full outage (the
// client then only sees ECONNREFUSED). The `ai` SDK rejects a
// NoOutputGeneratedError from a teardown promise nobody consumes, so an
// unhandled rejection is expected here -- log it loudly and keep serving.
// `uncaughtException` is deliberately left at its default behaviour.
process.on('unhandledRejection', (reason: unknown) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error(`[fatal] unhandledRejection: ${error.message}`);
  console.error(error.stack ?? '(no stack)');
});

console.log(`[Config] podletDir: ${prodConfig.podletDir}`);
console.log(`[Config] DB path: ${prodConfig.dbPath}`);
console.log(`[Config] port: ${prodConfig.port}, host: ${prodConfig.host}`);
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
