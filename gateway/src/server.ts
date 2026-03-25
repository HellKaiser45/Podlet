import { Elysia, t } from 'elysia';
import type { RunAgentInput } from './types';
import AppContainer from './runtime';


export function chatRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/api' })
    .post('/chat', async ({ body }) => {
      try {
        const input: RunAgentInput = {
          agentId: body.agentId,
          message: body.message,
          runId: body.runId,
          threadId: body.threadId,
          decision: body.decision,
        };

        console.log(`📨 Received request for agent: ${body.agentId}, runId: ${body.runId}`);

        const result = await container.orchestrator.executeAgent(input);

        return result;
      } catch (error) {
        console.error('❌ Error executing agent:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }, {
      body: t.Object({
        agentId: t.String(),
        message: t.String(),
        runId: t.String(),
        threadId: t.String(),
        decision: t.Optional(t.Record(t.String(), t.Any())),
      })
    })
}

export function createServer(container: AppContainer) {
  return new Elysia()
    .use(chatRoutes(container))
}

export async function cleanup(container: AppContainer) {
  console.log("\n👋 Shutting down gracefully...");
  await container.cleanup();
  process.exit(0);
}


