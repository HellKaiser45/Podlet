import { describe, expect, test } from 'bun:test';
import { EventType } from '@ag-ui/core';
import { AgentChatLoop } from '../src/agent-loop/chat-loop';
import { toModelMessages } from '../src/llm/messages';
import { AgentState, AgentToolSuspended, createContext } from '../src/types';

// ---------------------------------------------------------------------------
// A rejected tool must still answer its tool call. The assistant message
// carrying `tool_calls` is already in history, so a missing `role:'tool'` entry
// makes the very next LLM call die with AI_MissingToolResultsError.
// ---------------------------------------------------------------------------

const CALL_ID = 'call_abc123';

const toolCall = {
  id: CALL_ID,
  type: 'function',
  function: { name: 'search_docs', arguments: '{}' },
} as any;

type CallImpl = (name: string, id: string, args: unknown) => Promise<any>;

function makeLoop(call: CallImpl) {
  const events: Array<Record<string, any>> = [];
  const agent = {
    agentId: 'echo',
    agentDescription: 'test agent',
    model: 'stub',
    system_prompt: 'sys',
  };

  const container: any = {
    initConfig: { podletDir: '/tmp/podlet-stub', vision: { enabled: false } },
    agentManager: { agents: { echo: agent } },
    // Only the MCP branch is exercised; `isCoreTool` is overridden below and
    // the agent-tool branch never matches `search_docs`.
    mcpManager: { startserver: async () => {}, isRunning: () => true, call },
    agentToolsManager: { isAgentTool: () => false },
    skillManager: { availableSkills: {} },
    eventManager: { 'run-1': { push: (e: Record<string, any>) => events.push(e) } },
  };

  const context = createContext(
    { threadId: 'thread-1', runId: 'run-1', agentId: 'echo', message: { role: 'user', content: 'hi' } } as any,
    {
      frame_id: 'frame-1',
      agent_id: 'echo',
      // The assistant turn that requested the tool: toModelMessages resolves a
      // tool message's toolName from the nearest preceding assistant
      // `tool_calls`, so the history has to be built that way.
      history: [{ role: 'assistant', content: null, tool_calls: [toolCall] } as any],
      pending_approvals: [],
      status: 'running',
    },
  );

  const loop = new AgentChatLoop(context, container, 'echo');
  (loop as any).coreToolsManager = { isCoreTool: () => false };

  return { loop, context, events };
}

describe('a rejected tool call', () => {
  test('is converted into a role:"tool" history entry carrying the error content', async () => {
    const { loop, context, events } = makeLoop(() =>
      Promise.reject(new Error('MCP tool timed out after 30000ms')),
    );

    await (loop as any).executeTools([toolCall]);

    const toolMessages = context.frame.history.filter((m: any) => m.role === 'tool') as any[];
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].tool_call_id).toBe(CALL_ID);
    expect(toolMessages[0].content).toBe(
      JSON.stringify({ error: 'Failed to execute: MCP tool timed out after 30000ms' }),
    );

    const results = events.filter(
      (e) => e.type === EventType.TOOL_CALL_RESULT && e.toolCallId === CALL_ID,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe(toolMessages[0]!.content);

    // No dangling tool_call: every id the assistant asked for is answered.
    const assistant = context.frame.history.find((m: any) => m.role === 'assistant') as any;
    const answered = new Set(toolMessages.map((m) => m.tool_call_id));
    expect(assistant.tool_calls.every((tc: any) => answered.has(tc.id))).toBe(true);

    // And the resulting history is convertible for the next LLM call.
    const converted = toModelMessages(context.frame.history);
    const toolTurn = converted.find((m) => m.role === 'tool') as any;
    expect(toolTurn).toBeDefined();
    expect(toolTurn.content).toHaveLength(1);
    expect(toolTurn.content[0].toolCallId).toBe(CALL_ID);
    expect(toolTurn.content[0].toolName).toBe('search_docs');
  });

  test('a non-Error rejection reason is stringified, not swallowed', async () => {
    const { loop, context } = makeLoop(() => Promise.reject('socket closed'));

    await (loop as any).executeTools([toolCall]);

    const toolMessages = context.frame.history.filter((m: any) => m.role === 'tool') as any[];
    expect(toolMessages).toHaveLength(1);
    expect(JSON.parse(toolMessages[0]!.content)).toEqual({ error: 'Failed to execute: socket closed' });
    expect(() => toModelMessages(context.frame.history)).not.toThrow();
  });

  test('an AgentToolSuspended rejection is NOT converted and still suspends', async () => {
    const { loop, context, events } = makeLoop(() =>
      Promise.reject(new AgentToolSuspended('child-frame-1', 'child-agent')),
    );

    await (loop as any).executeTools([toolCall]);

    // No tool message: the suspension is what `Promise.allSettled` reads to
    // enter AWAITING_APPROVAL, so converting it would hide it.
    expect(context.frame.history.filter((m: any) => m.role === 'tool')).toHaveLength(0);
    expect(events.filter((e) => e.type === EventType.TOOL_CALL_RESULT)).toHaveLength(0);
    expect(context.currentState).toBe(AgentState.AWAITING_APPROVAL);
  });
});