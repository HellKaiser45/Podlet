import { prodConfig } from '@podlet/config';
import AppContainer from './runtime';
import { createServer, cleanup } from './server';

const container = new AppContainer(prodConfig)
await container.init()

export const app = createServer(container)
export type App = typeof app

process.on("SIGINT", () => cleanup(container));
process.on("SIGTERM", () => cleanup(container));

console.log(`🦊 Elysia server running at http://localhost:${prodConfig.appPort}`);
