import { Elysia } from 'elysia';
import AppContainer from '../runtime';

export default function modelsRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/models' })
    .get('/all', function ({ }) {
      return container.modelManager.models
    })
}


