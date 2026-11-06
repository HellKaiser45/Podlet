import { describe, expect, test, afterEach } from 'bun:test';
import { EventType } from '@ag-ui/core';
import { AgentClient } from '../src/agent_client';
import { AgentChatLoop } from '../src/agent-loop/chat-loop';
import { createContext, Agent, AgentState, AgentThinking, ModelConfig } from '../src/types';
import type { ResolvedModel } from '../src/system/providers';

// ---------------------------------------------------------------------------
// Agent.thinking -> request wiring. `reasoning_effort` is an agent setting now;
// the model-level field is never read.
// ---------------------------------------------------------------------------

const okModel: ResolvedModel = {
  health: { status: 'ok' },
  protocol: 'openai',
  headers: {},
  quirks: {},
};

const noReasoningEffortModel: ResolvedModel = {
  ...okModel,
  quirks: { no_reasoning_effort: true },
};

function makeContainer(thinking: AgentThinking | undefined, resolved: ResolvedModel) {
  const agent: Agent = {
    agentId: 'echo',
    agentDescription: 'test agent',
    model: 'stub',
    system_prompt: 'sys',
    thinking,
  };
  const model: ModelConfig = { provider: 'openai', model: 'gpt-4o-mini' };
  const events: Array<Record<string, unknown>> = [];

  const container: any = {
    initConfig: {
      podletDir: '/tmp/podlet-stub',
      llmApiUrl: 'http://stub.invalid',
      vision: { enabled: false },
    },
    agentManager: { agents: { echo: agent }, getAgentprompt: async () => 'sys' },
    modelManager: { models: { stub: model }, resolve: () => resolved },
    mcpManager: { getTools: () => [], startserver: async () => {} },
    agentToolsManager: { getAgentAsToolDefinition: async () => [], isAgentTool: () => false },
    skillManager: { injectSkills: async (_skills: string[], prompt: string) => prompt, availableSkills: {} },
    eventManager: { 'run-1': { push: (e: Record<string, unknown>) => events.push(e) } },
  };
  container.agentClient = new AgentClient(container);
  return { container, events };
}

const vfsStub = { getContextTree: async () => '' } as any;

const originalFetch = globalThis.fetch;

/** Replaces fetch with one that records each request body and answers a minimal SSE stream. */
function captureBodies(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const encoder = new TextEncoder();
    const payloads = [
      JSON.stringify({ type: 'chunk', chunk: { choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] } }),
      '[DONE]',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const payload of payloads) controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

async function drain(client: AgentClient) {
  for await (const _chunk of client.chatStream('echo', [], vfsStub)) {
    // consume
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('reasoning_effort is built from agent.thinking', () => {
  test("thinking 'none' omits the key entirely", async () => {
    const bodies = captureBodies();
    const { container } = makeContainer('none', okModel);

    await drain(container.agentClient);

    expect(bodies).toHaveLength(1);
    expect('reasoning_effort' in bodies[0]).toBe(false);
  });

  test('an undefined thinking omits the key entirely', async () => {
    const bodies = captureBodies();
    const { container } = makeContainer(undefined, okModel);

    await drain(container.agentClient);

    expect(bodies).toHaveLength(1);
    expect('reasoning_effort' in bodies[0]).toBe(false);
  });

  test("thinking 'high' sends the literal 'high'", async () => {
    const bodies = captureBodies();
    const { container } = makeContainer('high', okModel);

    await drain(container.agentClient);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].reasoning_effort).toBe('high');
  });

  test("thinking 'low' and 'medium' send their own literal", async () => {
    for (const level of ['low', 'medium'] as const) {
      const bodies = captureBodies();
      const { container } = makeContainer(level, okModel);

      await drain(container.agentClient);

      expect(bodies[0].reasoning_effort).toBe(level);
      globalThis.fetch = originalFetch;
    }
  });

  test('a model-level reasoning_effort is not read (the deprecated field is inert)', async () => {
    const bodies = captureBodies();
    const { container } = makeContainer(undefined, okModel);
    (container.modelManager.models.stub as ModelConfig).reasoning_effort = 'high';

    await drain(container.agentClient);

    expect('reasoning_effort' in bodies[0]).toBe(false);
  });
});

describe('a no_reasoning_effort quirk cannot silently swallow thinking', () => {
  test('thinking none still works on such a model and sends nothing', async () => {
    const bodies = captureBodies();
    const { container } = makeContainer('none', noReasoningEffortModel);

    await drain(container.agentClient);

    expect('reasoning_effort' in bodies[0]).toBe(false);
  });

  test('thinking high fails before any request is made', async () => {
    const bodies = captureBodies();
    const { container } = makeContainer('high', noReasoningEffortModel);

    await expect(drain(container.agentClient)).rejects.toThrow(
      "model 'stub': this provider rejects reasoning_effort; agent 'echo' requests thinking 'high'",
    );
    expect(bodies).toHaveLength(0);
  });

  test('the run ends with a RUN_ERROR carrying that reason, and no model call happens', async () => {
    const bodies = captureBodies();
    const { container, events } = makeContainer('medium', noReasoningEffortModel);

    const context = createContext(
      { threadId: 'thread-1', runId: 'run-1', agentId: 'echo', message: { role: 'user', content: 'hi' } },
      { frame_id: 'frame-1', agent_id: 'echo', history: [], pending_approvals: [], status: 'running' },
    );
    context.currentState = AgentState.CALLING_LLM;

    const loop = new AgentChatLoop(context, container, 'echo');
    await (loop as any).callLLM();

    const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
    expect(errorEvents).toHaveLength(1);
    expect(String(errorEvents[0].message)).toContain(
      "model 'stub': this provider rejects reasoning_effort; agent 'echo' requests thinking 'medium'",
    );
    expect(bodies).toHaveLength(0);
    expect(context.currentState).toBe(AgentState.FAILED);
  });
});