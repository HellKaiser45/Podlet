import { Elysia } from 'elysia';
import AppContainer from '../runtime';

export default function agentsRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/agents' })
    .get('/all', function ({ }) {
      return container.agentManager.agents
    })
    .get('/:agentId', function ({ params }) {
      return container.agentManager.agents[params.agentId]
    })
}
