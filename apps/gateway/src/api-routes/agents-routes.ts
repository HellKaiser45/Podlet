import { Elysia, t } from 'elysia';
import AppContainer from '../runtime';

export default function agentsRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/agents' })
    // GET all agents
    .get('/all', () => container.agentManager.agents)
    
    // GET single agent
    .get('/:agentId', ({ params, set }) => {
      const agent = container.agentManager.agents[params.agentId];
      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }
      return agent;
    })
    
    // GET agent's prompt text
    .get('/:agentId/prompt', async ({ params, set }) => {
      const agent = container.agentManager.agents[params.agentId];
      if (!agent) {
        set.status = 404;
        return { error: 'Agent not found' };
      }
      try {
        const prompt = await container.agentManager.getAgentprompt(params.agentId);
        return { content: prompt };
      } catch {
        set.status = 404;
        return { error: 'Prompt file not found' };
      }
    })
    
    // GET all available prompts
    .get('/prompts/list', async () => {
      return await container.agentManager.listPrompts();
    })
    
    // POST create agent
    .post('/', async ({ body, set }) => {
      try {
        const agent = await container.agentManager.create(body);
        set.status = 201;
        return agent;
      } catch (e: any) {
        set.status = 409;
        return { error: e.message };
      }
    }, {
      body: t.Object({
        agentId: t.String(),
        agentDescription: t.String(),
        model: t.String(),
        system_prompt: t.String(),
        mcps: t.Optional(t.Array(t.String())),
        skills: t.Optional(t.Array(t.String())),
        subAgents: t.Optional(t.Array(t.String())),
        response_format: t.Optional(t.Record(t.String(), t.Any())),
      })
    })
    
    // PUT update agent
    .put('/:agentId', async ({ params, body, set }) => {
      try {
        return await container.agentManager.update(params.agentId, body);
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    }, {
      body: t.Object({
        agentDescription: t.Optional(t.String()),
        model: t.Optional(t.String()),
        system_prompt: t.Optional(t.String()),
        mcps: t.Optional(t.Array(t.String())),
        skills: t.Optional(t.Array(t.String())),
        subAgents: t.Optional(t.Array(t.String())),
        response_format: t.Optional(t.Record(t.String(), t.Any())),
      })
    })
    
    // DELETE agent
    .delete('/:agentId', async ({ params, set }) => {
      try {
        await container.agentManager.delete(params.agentId);
        return { success: true };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    })
}
