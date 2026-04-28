import { Elysia, t } from 'elysia';
import AppContainer from '../runtime';

export default function mcpsRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/mcps' })
    // GET all MCP configs
    .get('/all', () => container.mcpManager.mcps)
    
    // GET running instances
    .get('/running', () => {
      const running = container.mcpManager.runningInstances;
      const result: Record<string, { tools: string[] }> = {};
      for (const [name, instance] of Object.entries(running)) {
        result[name] = {
          tools: instance.tools.map(t => t.function?.name ?? t.name ?? 'unknown')
        };
      }
      return result;
    })
    
    // GET single MCP config
    .get('/:name', ({ params, set }) => {
      const mcp = container.mcpManager.mcps[params.name];
      if (!mcp) {
        set.status = 404;
        return { error: 'MCP not found' };
      }
      return { name: params.name, ...mcp };
    })
    
    // POST create MCP config
    .post('/', async ({ body, set }) => {
      try {
        const config = await container.mcpManager.createConfig(body.name, body.config);
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
          command: t.String(),
          args: t.Optional(t.Array(t.String())),
          env: t.Optional(t.Record(t.String(), t.String())),
        })
      })
    })
    
    // PUT update MCP config
    .put('/:name', async ({ params, body, set }) => {
      try {
        const config = await container.mcpManager.updateConfig(params.name, body);
        return { name: params.name, ...config };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    }, {
      body: t.Object({
        command: t.Optional(t.String()),
        args: t.Optional(t.Array(t.String())),
        env: t.Optional(t.Record(t.String(), t.String())),
      })
    })
    
    // DELETE MCP config
    .delete('/:name', async ({ params, set }) => {
      try {
        await container.mcpManager.deleteConfig(params.name);
        return { success: true };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    })
    
    // POST start MCP server
    .post('/:name/start', async ({ params, set }) => {
      if (!container.mcpManager.mcps[params.name]) {
        set.status = 404;
        return { error: 'MCP not found' };
      }
      try {
        await container.mcpManager.startserver(params.name);
        return { success: true };
      } catch (e: any) {
        set.status = 500;
        return { error: e.message };
      }
    })
    
    // POST stop MCP server
    .post('/:name/stop', async ({ params, set }) => {
      if (!container.mcpManager.runningInstances[params.name]) {
        set.status = 404;
        return { error: 'MCP not running' };
      }
      await container.mcpManager.stop(params.name);
      return { success: true };
    })
}
