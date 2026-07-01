import { Elysia, t } from 'elysia';
import AppContainer from '../runtime';

export default function modelsRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/models' })
    // GET all models
    .get('/all', () => container.modelManager.models)

    // GET single model
    .get('/:name', ({ params, set }) => {
      const model = container.modelManager.load(params.name);
      if (!model) {
        set.status = 404;
        return { error: 'Model not found' };
      }
      return { name: params.name, ...model };
    })

    // POST create model
    .post('/', async ({ body, set }) => {
      try {
        const config = await container.modelManager.create(body.name, body.config);
        set.status = 201;
        return { name: body.name, ...config };
      } catch (e: any) {
        set.status = 409;
        return { error: e.message };
      }
    }, {
      body: t.Object({
        name: t.String(),
        config: t.Object({
          provider: t.String(),
          model: t.String(),
          api_key_name: t.Optional(t.String()),
          temperature: t.Optional(t.Number()),
          max_tokens: t.Optional(t.Number()),
          base_url: t.Optional(t.String()),
        })
      })
    })

    // PUT update model
    .put('/:name', async ({ params, body, set }) => {
      try {
        const config = await container.modelManager.update(params.name, body);
        return { name: params.name, ...config };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    }, {
      body: t.Object({
        provider: t.Optional(t.String()),
        model: t.Optional(t.String()),
        api_key_name: t.Optional(t.String()),
        temperature: t.Optional(t.Number()),
        max_tokens: t.Optional(t.Number()),
        base_url: t.Optional(t.String()),
      })
    })

    // DELETE model
    .delete('/:name', async ({ params, set }) => {
      try {
        await container.modelManager.delete(params.name);
        return { success: true };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    })
}
