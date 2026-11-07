import { describe, expect, test } from 'bun:test';
import { AgentOrchestrator, projectHistoryForPersistence } from '../src/orchestrator';
import type AppContainer from '../src/runtime';
import type { AgentStackFrame, LiteLLMMessage, RunAgentInput } from '../src/types';

const reasoning = 'Let me think about this step by step.';
const thinkingBlocks = [{ type: 'thinking' as const, thinking: reasoning, signature: 'sig-abc' }];

function terminalAssistant(content: string | null): LiteLLMMessage {
  return {
    role: 'assistant',
    content,
    reasoning_content: reasoning,
    thinking_blocks: thinkingBlocks,
  } as LiteLLMMessage;
}

/** A frame shaped like the one the loop hands to EndingEventHandler. */
function buildFrame(): AgentStackFrame {
  return {
    frame_id: 'frame-1',
    agent_id: 'coder',
    status: 'completed',
    pending_approvals: [],
    history: [
      { role: 'user', content: 'write a file' } as LiteLLMMessage,
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'write_file', arguments: '{}' } },
        ],
      } as LiteLLMMessage,
      { role: 'tool', tool_call_id: 'tc1', content: 'ok' } as LiteLLMMessage,
      terminalAssistant('done'),
    ],
  };
}

interface Harness {
  orchestrator: AgentOrchestrator;
  pushed: any[];
  persisted: LiteLLMMessage[][];
}

function makeHarness(): Harness {
  const pushed: any[] = [];
  const persisted: LiteLLMMessage[][] = [];
  const container = {
    eventManager: {
      'run-1': { push: (event: any) => { pushed.push(event); } },
    },
    historyManager: {
      update: async (_runId: string, history: LiteLLMMessage[]) => { persisted.push(history); },
    },
    usageSink: () => {},
  };
  return {
    orchestrator: new AgentOrchestrator(container as unknown as AppContainer),
    pushed,
    persisted,
  };
}

const input: RunAgentInput = {
  threadId: 'thread-1',
  runId: 'run-1',
  agentId: 'coder',
  message: { role: 'user', content: 'write a file' },
};

describe('projectHistoryForPersistence', () => {
  test('(a) a terminal assistant message with reasoning_content + thinking_blocks persists neither key', () => {
    const projection = projectHistoryForPersistence([terminalAssistant('done')]);

    expect(projection).toHaveLength(1);
    expect(projection[0]).not.toHaveProperty('reasoning_content');
    expect(projection[0]).not.toHaveProperty('thinking_blocks');
    expect('reasoning_content' in projection[0]!).toBe(false);
    expect('thinking_blocks' in projection[0]!).toBe(false);
    expect(Object.keys(projection[0]!).sort()).toEqual(['content', 'role']);
    expect(projection[0]!.content).toBe('done');
  });

  test('(b) a user message and an assistant message with plain content survive unchanged', () => {
    const history: LiteLLMMessage[] = [
      { role: 'user', content: 'hello' } as LiteLLMMessage,
      { role: 'assistant', content: 'hi there' } as LiteLLMMessage,
    ];

    const projection = projectHistoryForPersistence(history);

    expect(projection).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  test('(c) assistant messages WITH tool_calls are still excluded from the projection', () => {
    const frame = buildFrame();
    const projection = projectHistoryForPersistence(frame.history);

    expect(projection).toHaveLength(2);
    expect(projection.map(m => m.role)).toEqual(['user', 'assistant']);
    // the surviving assistant message is the terminal one, not the tool-calling one
    expect(projection[1]!.content).toBe('done');
    expect(projection.some(m => 'tool_calls' in m && (m as any).tool_calls?.length)).toBe(false);
    expect(projection.some(m => m.role === 'tool')).toBe(false);
  });

  test('(d) the source history keeps its reasoning after the projection runs', () => {
    const frame = buildFrame();
    const projection = projectHistoryForPersistence(frame.history);

    expect(projection).not.toBe(frame.history);
    const terminal = frame.history[frame.history.length - 1]!;
    expect(terminal.reasoning_content).toBe(reasoning);
    expect(terminal.thinking_blocks).toEqual(thinkingBlocks);
    // the projected object is a copy, not the live message
    expect(projection[1]).not.toBe(terminal);
  });
});

describe('EndingEventHandler reasoning strip', () => {
  test('run_history receives a projection without reasoning keys', async () => {
    const { orchestrator, persisted } = makeHarness();
    await orchestrator.EndingEventHandler(input, buildFrame());

    expect(persisted).toHaveLength(1);
    const history = persisted[0]!;
    expect(history).toHaveLength(2);
    for (const message of history) {
      expect(message).not.toHaveProperty('reasoning_content');
      expect(message).not.toHaveProperty('thinking_blocks');
    }
  });

  test('the RUN_FINISHED payload carries no reasoning and leaves the live frame untouched', async () => {
    const { orchestrator, pushed } = makeHarness();
    const frame = buildFrame();
    await orchestrator.EndingEventHandler(input, frame);

    const finished = pushed.find(e => e.type === 'RUN_FINISHED');
    expect(finished).toBeDefined();
    expect(finished.result).not.toBe(frame);
    expect(finished.result.frame_id).toBe(frame.frame_id);

    for (const message of finished.result.history) {
      expect(message).not.toHaveProperty('reasoning_content');
      expect(message).not.toHaveProperty('thinking_blocks');
    }

    const terminal = frame.history[frame.history.length - 1]!;
    expect(terminal.reasoning_content).toBe(reasoning);
    expect(terminal.thinking_blocks).toEqual(thinkingBlocks);
  });
});