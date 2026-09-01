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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith('Invalid agent id')) {
          set.status = 400;
        } else {
          set.status = 409;
        }
        return { error: msg };
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
      const newAgentId = body.agentId?.trim();
      if (newAgentId && newAgentId !== params.agentId) {
        const activeCount = Object.keys(container.eventManager).length;
        if (activeCount > 0) {
          set.status = 409;
          return { error: `Cannot rename agent while ${activeCount} active stream(s) are running. Please wait for them to finish.` };
        }
      }
      try {
        return await container.agentManager.update(params.agentId, body);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith('Agent already exists')) {
          set.status = 409;
        } else if (msg.startsWith('Invalid agent id')) {
          set.status = 400;
        } else if (msg.startsWith('Agent not found') || msg.startsWith('Agent file not found')) {
          set.status = 404;
        } else {
          // unexpected failures (e.g. Bun fs errors) can leak absolute server paths
          set.status = 500;
          return { error: 'Internal server error while updating agent' };
        }
        return { error: msg };
      }
    }, {
      body: t.Object({
        agentId: t.Optional(t.String()),
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
      const activeCount = Object.keys(container.eventManager).length;
      if (activeCount > 0) {
        set.status = 409;
        return { error: `Cannot delete agent while ${activeCount} active stream(s) are running. Please wait for them to finish.` };
      }
      try {
        await container.agentManager.delete(params.agentId);
        return { success: true };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    })
}
