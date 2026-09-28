import { createServer } from './server';

const tempApp = createServer({} as any)
export type App = typeof tempApp

