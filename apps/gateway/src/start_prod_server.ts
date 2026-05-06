import { prodConfig } from '@podlet/config';
import AppContainer from './runtime';
import { createServer, cleanup } from './server';

console.log(`[Config] podeletDir: ${prodConfig.podeletDir}`);
console.log(`[Config] DB path: ${prodConfig.podeletDir}/${prodConfig.dbName}`);
console.log(`[Config] Docker: enabled=${prodConfig.docker.enabled}, staticFrontend=${prodConfig.docker.staticFrontend}`);
console.log(`[Config] llmApiUrl: ${prodConfig.llmApiUrl}`);
console.log(`[Config] corsOrigin: ${prodConfig.corsOrigin}`);
console.log(`[Config] host: ${prodConfig.host}, appPort: ${prodConfig.appPort}`);

const container = new AppContainer(prodConfig)
await container.init()

export const app = await createServer(container)
export type App = typeof app

process.on("SIGINT", () => cleanup(container));
process.on("SIGTERM", () => cleanup(container));

console.log(`🦊 Elysia server running at http://localhost:${prodConfig.appPort}`);
