import { describe, expect, test } from 'bun:test';
import { EventType } from '@ag-ui/core';
import { AgentClient } from '../src/agent_client';
import { AgentChatLoop } from '../src/agent-loop/chat-loop';
import { createContext, Agent, AgentState, AgentThinking, ModelConfig } from '../src/types';
import type { ResolvedModel } from '../src/system/providers';
import { buildProviderOptions } from '../src/llm/thinking';

// ---------------------------------------------------------------------------
// Agent.thinking -> request wiring. `reasoning_effort` is an agent setting now;
// the model-level field is never read. The transport is in-process, so this
// suite inspects the resolved request plus the providerOptions it produces
// (exactly what `chatStream` hands to `runLlmStream`), instead of an HTTP body.
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

/** Resolve the request the way `chatStream` does, then produce its providerOptions. */
async function resolveProviderOptions(container: any, agentId = 'echo') {
  const request = await container.agentClient.buildRequest(agentId, [], vfsStub);
  return buildProviderOptions(request.protocol, request.thinking, request.resolved.quirks);
}

async function drain(client: AgentClient) {
  for await (const _chunk of client.chatStream('echo', [], vfsStub)) {
    // consume
  }
}

describe('reasoning_effort is built from agent.thinking', () => {
  test("thinking 'none' omits the key entirely", async () => {
    const { container } = makeContainer('none', okModel);

    const providerOptions = await resolveProviderOptions(container);

    expect('reasoning_effort' in providerOptions).toBe(false);
    expect(providerOptions).toEqual({});
  });

  test('an undefined thinking omits the key entirely', async () => {
    const { container } = makeContainer(undefined, okModel);

    const providerOptions = await resolveProviderOptions(container);

    expect('reasoning_effort' in providerOptions).toBe(false);
    expect(providerOptions).toEqual({});
  });

  test("thinking 'high' sends the top-of-scale literal 'max'", async () => {
    const { container } = makeContainer('high', okModel);

    const providerOptions = await resolveProviderOptions(container);

    expect(providerOptions.openai?.reasoningEffort).toBe('max');
  });

  test("thinking 'low' and 'medium' send their own literal", async () => {
    for (const level of ['low', 'medium'] as const) {
      const { container } = makeContainer(level, okModel);

      const providerOptions = await resolveProviderOptions(container);

      expect(providerOptions.openai?.reasoningEffort).toBe(level);
    }
  });

  test('a model-level reasoning_effort is not read (the deprecated field is inert)', async () => {
    const { container } = makeContainer(undefined, okModel);
    (container.modelManager.models.stub as ModelConfig).reasoning_effort = 'high';

    const providerOptions = await resolveProviderOptions(container);

    expect('reasoning_effort' in providerOptions).toBe(false);
  });
});

describe('a no_reasoning_effort quirk cannot silently swallow thinking', () => {
  test('thinking none still works on such a model and sends nothing', async () => {
    const { container } = makeContainer('none', noReasoningEffortModel);

    const providerOptions = await resolveProviderOptions(container);

    expect(providerOptions).toEqual({});
  });

  test('thinking high fails before any request is made', async () => {
    const { container } = makeContainer('high', noReasoningEffortModel);

    await expect(resolveProviderOptions(container)).rejects.toThrow(
      "model 'stub': this provider rejects reasoning_effort; agent 'echo' requests thinking 'high'",
    );
  });

  test('the run ends with a RUN_ERROR carrying that reason, and no model call happens', async () => {
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
    expect(context.currentState).toBe(AgentState.FAILED);
  });
});