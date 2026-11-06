import { describe, expect, test, afterEach } from 'bun:test';
import { EventType } from '@ag-ui/core';
import { AgentClient } from '../src/agent_client';
import { AgentChatLoop } from '../src/agent-loop/chat-loop';
import { createContext, Agent, AgentState, AgentThinking, ModelConfig } from '../src/types';
import { resolveModel } from '../src/system/providers';

// ---------------------------------------------------------------------------
// An unusable model is never dispatched. The health reason the ModelsManager
// already computed is what the user sees -- exactly once, and with no request
// leaving the gateway.
// ---------------------------------------------------------------------------

function makeContainer(entry: unknown, thinking?: AgentThinking) {
  const agent: Agent = {
    agentId: 'echo',
    agentDescription: 'test agent',
    model: 'stub',
    system_prompt: 'sys',
    thinking,
  };
  const models: Record<string, ModelConfig> = entry === undefined
    ? {}
    : { stub: entry as ModelConfig };
  const events: Array<Record<string, unknown>> = [];

  const container: any = {
    initConfig: {
      podletDir: '/tmp/podlet-stub',
      llmApiUrl: 'http://stub.invalid',
      vision: { enabled: false },
    },
    agentManager: { agents: { echo: agent }, getAgentprompt: async () => 'sys' },
    modelManager: {
      models,
      resolve: (name: string) => (models[name] ? resolveModel(name, models[name], {}) : undefined),
    },
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

/** Replaces fetch with one that counts calls and would answer a valid SSE stream. */
function countFetches(): Array<Record<string, unknown>> {
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

async function runLoop(container: any) {
  const context = createContext(
    { threadId: 'thread-1', runId: 'run-1', agentId: 'echo', message: { role: 'user', content: 'hi' } },
    { frame_id: 'frame-1', agent_id: 'echo', history: [], pending_approvals: [], status: 'running' },
  );
  context.currentState = AgentState.CALLING_LLM;

  const loop = new AgentChatLoop(context, container, 'echo');
  await (loop as any).callLLM();
  return context;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('an unusable model is not dispatched', () => {
  test('one RUN_ERROR carries the health reason and no fetch is made', async () => {
    const bodies = countFetches();
    // No key in the env: this entry is unusable, and resolveModel says why.
    const { container, events } = makeContainer({ provider: 'openrouter', model: 'google/gemma-4-31b-it' });

    const context = await runLoop(container);

    const reason = resolveModel('stub', { provider: 'openrouter', model: 'google/gemma-4-31b-it' }, {}).health.reason!;
    expect(reason).toContain('OPENROUTER_API_KEY');

    const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
    expect(errorEvents).toHaveLength(1);
    expect(String(errorEvents[0].message)).toContain(reason);
    expect(bodies).toHaveLength(0);
    expect(context.currentState).toBe(AgentState.FAILED);
  });

  test('a model missing from the record reports "not found" instead of crashing', async () => {
    const bodies = countFetches();
    const { container, events } = makeContainer(undefined);

    const context = await runLoop(container);

    const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
    expect(errorEvents).toHaveLength(1);
    expect(String(errorEvents[0].message)).toContain("model 'stub': not found in models.json");
    expect(bodies).toHaveLength(0);
    expect(context.currentState).toBe(AgentState.FAILED);
  });

  test('a legacy reasoning_effort key reports the legacy key, not the quirk conflict', async () => {
    const bodies = countFetches();
    const { container, events } = makeContainer({ provider: 'openai', model: 'gpt-4o-mini', reasoning_effort: 'high' }, 'high');

    const context = await runLoop(container);

    const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
    expect(errorEvents).toHaveLength(1);
    expect(String(errorEvents[0].message)).toContain('reasoning_effort is no longer a model setting');
    expect(String(errorEvents[0].message)).not.toContain('rejects reasoning_effort');
    expect(bodies).toHaveLength(0);
    expect(context.currentState).toBe(AgentState.FAILED);
  });
});

describe('an unusable model keeps the quirks it declared', () => {
  test('no_reasoning_effort survives an unrelated failure reason', async () => {
    const entry = { provider: 'openrouter', model: 'x', quirks: { no_reasoning_effort: true } };
    const resolved = resolveModel('stub', entry, {});

    expect(resolved.health.status).toBe('unusable');
    // Unrelated reason: the missing key, not the quirk.
    expect(resolved.health.reason).toContain('OPENROUTER_API_KEY');
    expect(resolved.quirks).toEqual({ no_reasoning_effort: true });
  });

  test('the retained quirk does not mask the real reason at dispatch', async () => {
    const bodies = countFetches();
    const { container, events } = makeContainer(
      { provider: 'openrouter', model: 'x', quirks: { no_reasoning_effort: true } },
      'high',
    );

    const context = await runLoop(container);

    const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
    expect(errorEvents).toHaveLength(1);
    expect(String(errorEvents[0].message)).toContain('OPENROUTER_API_KEY');
    expect(String(errorEvents[0].message)).not.toContain('rejects reasoning_effort');
    expect(bodies).toHaveLength(0);
    expect(context.currentState).toBe(AgentState.FAILED);
  });
});