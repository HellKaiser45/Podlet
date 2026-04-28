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
import promptsRoutes from './api-routes/prompts-routes';
import cors from '@elysiajs/cors';
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

      const stream = new AgentEventStream();
      container.eventManager[body.runId] = stream;

      request.signal.addEventListener('abort', async () => {
        try {
          console.log('[Route] Abort signal received. Closing stream...');
          await stream.close();
          console.log('[Route] Stream closed successfully.');
        } catch (err) {
          console.error('[Route] ERROR during abort cleanup:', err); // This will catch the .catch() TypeError
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
          stream.close().catch((err) => {
            console.error('[route] stream.close() failed:', err);
          });
          delete container.eventManager[body.runId];
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

export function createServer(container: AppContainer) {
  return new Elysia({ prefix: '/api' })
    .use(openapi({
      documentation: {
        info: { title: 'Podlet API', version: '0.1.0' },
        servers: [{ url: `http://localhost:${container.initConfig.appPort}` }],
      }
    }))
    .use(cors({ origin: 'http://localhost:3002' }))
    .use(chatRoutes(container))
    .use(agentsRoutes(container))
    .use(modelsRoutes(container))
    .use(mcpsRoutes(container))
    .use(promptsRoutes(container))
    .use(filesRoutes(container))
    .listen(container.initConfig.appPort);
}

export async function cleanup(container: AppContainer) {
  await container.cleanup();
  process.exit(0);
}

