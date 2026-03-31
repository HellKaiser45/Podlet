import { Elysia } from 'elysia';
import { RunAgentInput, RunAgentInputSchema } from './types';
import AppContainer from './runtime';
import { EventType } from '@ag-ui/core';
import { AgentEventStream } from './stream_handler';


export function chatRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/api' })
    .post('/chat', async function* ({ body }) {
      const input = {
        threadId: body.threadId,
        runId: body.runId,
        state: body.state || {},
        tools: [],
        context: [],
        message: body.message,
        forwardedProps: body.forwardedProps,
      } satisfies RunAgentInput

      const stream = new AgentEventStream();
      container.eventManager[body.runId] = stream;
      container.orchestrator.executeAgent(input)
        .catch((err) => {
          console.log("error in orchestrator", err)
          stream.push({ AgentId: body.forwardedProps.agentId, type: EventType.RUN_ERROR, message: err.message || "Unknown orchestration error" });
        })
        .finally(() => {
          console.log("closing stream");
          stream.close();
          delete container.eventManager[body.runId];
        });

      return stream

    }, {
      body: RunAgentInputSchema,
    })
}

export function createServer(container: AppContainer) {
  return new Elysia()
    .use(chatRoutes(container))
}

export async function cleanup(container: AppContainer) {
  await container.cleanup();
  process.exit(0);
}


