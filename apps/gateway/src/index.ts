import { createServer } from './server';

export type App = Awaited<ReturnType<typeof createServer>>
