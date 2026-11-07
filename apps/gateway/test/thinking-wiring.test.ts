import { describe, expect, test } from 'bun:test';
import { EventType } from '@ag-ui/core';
import { AgentClient } from '../src/agent_client';
import { AgentChatLoop } from '../src/agent-loop/chat-loop';
import { createContext, Agent, AgentState, AgentThinking, ModelConfig } from '../src/types';
import type { ResolvedModel } from '../src/system/providers';
import { mapReasoning } from '../src/llm/thinking';

// ---------------------------------------------------------------------------
// Agent.thinking -> request wiring. `reasoning_effort` is an agent setting now;
// the model-level field is never read. The transport is in-process, so this
// suite inspects the resolved request plus the portable `reasoning` value it
// produces (exactly what `chatStream` hands to `runLlmStream`), instead of an
// HTTP body.
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

/** Resolve the request the way `chatStream` does, then map it to `reasoning`. */
async function resolveReasoning(container: any, agentId = 'echo') {
  const request = await container.agentClient.buildRequest(agentId, [], vfsStub);
  return mapReasoning(request.protocol, request.thinking, request.resolved.quirks);
}

describe('reasoning is built from agent.thinking', () => {
  test("thinking 'none' omits the option entirely", async () => {
    const { container } = makeContainer('none', okModel);

    expect(await resolveReasoning(container)).toBeUndefined();
  });

  test('an undefined thinking omits the option entirely', async () => {
    const { container } = makeContainer(undefined, okModel);

    expect(await resolveReasoning(container)).toBeUndefined();
  });

  test("thinking 'high' sends the top-of-scale literal 'max'", async () => {
    const { container } = makeContainer('high', okModel);

    expect(await resolveReasoning(container)).toBe('max');
  });

  test("thinking 'low' and 'medium' send their own literal", async () => {
    for (const level of ['low', 'medium'] as const) {
      const { container } = makeContainer(level, okModel);

      expect(await resolveReasoning(container)).toBe(level);
    }
  });

  test('a model-level reasoning_effort is not read (the deprecated field is inert)', async () => {
    const { container } = makeContainer(undefined, okModel);
    (container.modelManager.models.stub as ModelConfig).reasoning_effort = 'high';

    expect(await resolveReasoning(container)).toBeUndefined();
  });

  // The mapping is per protocol, not per provider instance: `opencode` speaks
  // the openai wire protocol and therefore shares OpenAI's scale.
  test("a non-canonical openai-compatible provider follows the openai scale", async () => {
    const { container } = makeContainer('high', okModel);
    (container.modelManager.models.stub as ModelConfig).provider = 'opencode';

    expect(await resolveReasoning(container)).toBe('max');
  });
});

describe('a no_reasoning_effort quirk cannot silently swallow thinking', () => {
  test('thinking none still works on such a model and sends nothing', async () => {
    const { container } = makeContainer('none', noReasoningEffortModel);

    expect(await resolveReasoning(container)).toBeUndefined();
  });

  test('thinking high fails before any request is made', async () => {
    const { container } = makeContainer('high', noReasoningEffortModel);

    await expect(resolveReasoning(container)).rejects.toThrow(
      "model 'stub': this provider rejects reasoning_effort; agent 'echo' requests thinking 'high'",
    );
  });

  test("thinking 'low' fails loudly too, naming the model and the agent", async () => {
    const { container } = makeContainer('low', noReasoningEffortModel);

    await expect(resolveReasoning(container)).rejects.toThrow(
      "model 'stub': this provider rejects reasoning_effort; agent 'echo' requests thinking 'low'",
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