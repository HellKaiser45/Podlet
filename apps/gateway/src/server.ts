import { Elysia, sse, t } from 'elysia';
import { RunAgentInput, RunAgentInputSchema } from './types';
import AppContainer from './runtime';
import { EventType } from '@ag-ui/core';
import { AgentEventStream } from './stream_handler';
import { openapi } from '@elysiajs/openapi';
import agentsRoutes from './api-routes/agents-routes';
import modelsRoutes from './api-routes/models-routes';
import mcpsRoutes from './api-routes/mcps-routes';
import filesRoutes from './api-routes/files-routes';
import { skillsRoutes } from "./api-routes/skills-routes";
import promptsRoutes from './api-routes/prompts-routes';
import cors from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import { VirtualFileSystem } from './system/sandbox';



export function chatRoutes(container: AppContainer) {
  return new Elysia()
    .post('/chat', async function* ({ body, set, request }) {
      const input = {
        threadId: body.threadId,
        runId: body.runId,
        parentRunId: body.parentRunId,
        cwd: body.cwd,
        message: body.message,
        attachmentIds: body.attachmentIds,
        agentId: body.agentId,
        decision: body.decision,
      } satisfies RunAgentInput

      if (container.eventManager[body.runId]) {
        set.status = 409;
        return { message: "A stream is already active for this runId" };
      }

      const stream = new AgentEventStream();
      container.eventManager[body.runId] = stream;

      request.signal.addEventListener('abort', async () => {
        try {
          console.log('[Route] Abort signal receive. Closing stream...');
          await stream.close();
          delete container.eventManager[body.runId];
          console.log('[Route] Stream closed successfully.');
        } catch (err) {
          console.error('[Route] ERROR during abort cleanup:', err);
        }
      });

      container.orchestrator.executeAgent(input)
        .catch((err) => {
          stream.push({
            AgentId: body.agentId,
            type: EventType.RUN_ERROR,
            message: err?.message ?? 'Unknown orchestration error'
          });
        })
        .finally(() => {
          stream.close().catch(() => {});
          if (container.eventManager[body.runId] === stream) {
            delete container.eventManager[body.runId];
          }
        });

      set.headers['Connection'] = 'keep-alive';
      set.headers['Cache-Control'] = 'no-cache';
      set.headers['X-Accel-Buffering'] = 'no';

      try {
        for await (const event of stream) {
          try {
            yield sse({ data: event });
          } catch (yieldErr) {
            console.error('[route] Failed to yield event:', yieldErr, event);
          }
        }
      } catch (streamErr) {
        console.error('[route] Stream iteration error:', streamErr);
      }
    }, {
      body: RunAgentInputSchema,
    })
    .get(`/history/:runid`, async function ({ params }) {
      return await container.historyManager.getByRunId(params.runid)
    })
    .get('runids', async function (): Promise<{ runId: string; preview: string | null; label: string | null; createdAt: Date | null }[]> {
      return await container.historyManager.getAllRuns()
    })
    .patch('history/label/:runid', async ({ params, body, set }) => {
      const exists = await container.historyManager.exists(params.runid);
      if (!exists) {
        set.status = 404;
        return { message: `No history found for runId: ${params.runid}` };
      }

      await container.historyManager.setLabel(params.runid, body.label);
      return { success: true };
    }, {
      params: t.Object({ runid: t.String() }),
      body: t.Object({ label: t.String({ maxLength: 100 }) }),
    })
    .delete('chat/:runid', async ({ params }) => {
      console.log('deleting chat history for runId: ', params.runid)
      const exists = await container.historyManager.exists(params.runid);
      if (exists) await container.historyManager.deleteByRunId(params.runid)

      const virtualManager = new VirtualFileSystem(container.initConfig.podeletDir, params.runid)
      virtualManager.deleteFolder(params.runid)
    })
}

export async function createServer(container: AppContainer) {
  const corsOrigin = container.initConfig.corsOrigin;

  // Check if static frontend files exist
  let staticFrontend = false;
  try {
    const stat = await Bun.file('/app/frontend/dist/index.html').stat();
    staticFrontend = !!stat;
  } catch {}

  const api = new Elysia({ prefix: '/api' })
    .onRequest(({ request, set }) => {
      const start = Date.now();
      return () => {
        const ms = Date.now() - start;
        console.log(`[Request] ${request.method} ${new URL(request.url).pathname} ${set.status} ${ms}ms`);
      };
    })
    .use(openapi({
      documentation: {
        info: { title: 'Podlet API', version: '0.1.0' },
        servers: [{ url: `http://localhost:${container.initConfig.port}` }],
      }
    }))
    .use(cors({ origin: corsOrigin }))
    .use(chatRoutes(container))
    .use(agentsRoutes(container))
    .use(modelsRoutes(container))
    .use(mcpsRoutes(container))
    .use(promptsRoutes(container))
    .use(filesRoutes(container))
    .use(skillsRoutes(container));

  if (staticFrontend) {
    return new Elysia()
      .use(api)
      .use(await staticPlugin({
        assets: '/app/frontend/dist',
        prefix: '',
        indexHTML: true,
      }))
      .listen(container.initConfig.port);
  }

  return api.listen(container.initConfig.port);
}

export async function cleanup(container: AppContainer) {
  await container.cleanup();
  process.exit(0);
}
