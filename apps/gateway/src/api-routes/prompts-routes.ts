import { Elysia, t } from 'elysia';
import AppContainer from '../runtime';

export default function promptsRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/prompts' })
    // GET all prompt names
    .get('/all', async () => {
      return await container.promptManager.list();
    })
    
    // GET single prompt content
    .get('/:name', async ({ params, set }) => {
      try {
        const content = await container.promptManager.read(params.name);
        return { name: params.name, content };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    })
    
    // POST create prompt
    .post('/', async ({ body, set }) => {
      try {
        await container.promptManager.create(body.name, body.content);
        set.status = 201;
        return { success: true };
      } catch (e: any) {
        set.status = 409;
        return { error: e.message };
      }
    }, {
      body: t.Object({
        name: t.String(),
        content: t.String(),
      })
    })
    
    // PUT update prompt
    .put('/:name', async ({ params, body, set }) => {
      try {
        await container.promptManager.update(params.name, body.content);
        return { success: true };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    }, {
      body: t.Object({
        content: t.String(),
      })
    })
    
    // DELETE prompt
    .delete('/:name', async ({ params, set }) => {
      try {
        await container.promptManager.delete(params.name);
        return { success: true };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    })
}
