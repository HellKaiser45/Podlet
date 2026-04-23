import { Elysia } from 'elysia';
import AppContainer from '../runtime';

export default function mcpsRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/mcps' })
    .get('/all', function ({ }) {
      return container.mcpManager.mcps
    })
    .get('/running', function ({ }) {
      return container.mcpManager.runningInstances
    })
}

