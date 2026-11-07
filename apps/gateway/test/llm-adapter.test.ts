import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { buildProviderOptions } from '../src/llm/thinking';
import { toModelMessages } from '../src/llm/messages';
import { runLlmStream } from '../src/llm/stream';
import type { Protocol, ProviderQuirks } from '../src/types';

const noQuirks: ProviderQuirks = {};

describe('buildProviderOptions', () => {
  test.each<[Protocol, string, string, Record<string, Record<string, unknown>>]>([
    ['openai', 'low', 'openai', { openai: { reasoningEffort: 'low' } }],
    ['openai', 'medium', 'openai', { openai: { reasoningEffort: 'medium' } }],
    ['openai', 'high', 'openai', { openai: { reasoningEffort: 'max' } }],
    [
      'anthropic',
      'low',
      'anthropic',
      { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 }, sendReasoning: true } },
    ],
    [
      'anthropic',
      'medium',
      'anthropic',
      { anthropic: { thinking: { type: 'enabled', budgetTokens: 8192 }, sendReasoning: true } },
    ],
    [
      'anthropic',
      'high',
      'anthropic',
      { anthropic: { thinking: { type: 'enabled', budgetTokens: 32000 }, sendReasoning: true } },
    ],
    ['google', 'low', 'google', { google: { thinkingConfig: { thinkingLevel: 'low', includeThoughts: true } } }],
    ['google', 'medium', 'google', { google: { thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true } } }],
    ['google', 'high', 'google', { google: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } } }],
  ])('%s / %s / %s maps to the tier table', (protocol, level, providerName, expected) => {
    expect(buildProviderOptions(protocol, level as any, noQuirks, providerName)).toEqual(expected);
  });

  test.each<Protocol>(['openai', 'anthropic', 'google'])(
    'none produces no providerOptions block on %s',
    (protocol) => {
      expect(buildProviderOptions(protocol, 'none', noQuirks, 'opencode')).toEqual({});
      expect(buildProviderOptions(protocol, undefined, noQuirks, 'opencode')).toEqual({});
    },
  );

  test('no_reasoning_effort throws instead of silently dropping thinking', () => {
    expect(() => buildProviderOptions('openai', 'high', { no_reasoning_effort: true }, 'openai')).toThrow();
    // `none` is unaffected by the quirk.
    expect(buildProviderOptions('openai', 'none', { no_reasoning_effort: true }, 'openai')).toEqual({});
  });

  // The outer providerOptions key is the namespace the INSTANTIATED provider
  // resolves, not the wire protocol. @ai-sdk/openai-compatible derives it from
  // its own name (src/chat/openai-compatible-chat-language-model.ts:179), so an
  // `opencode` instance never reads `providerOptions.openai` — emitting that key
  // was the silent drop this case pins down.
  test('a non-canonical openai-compatible provider name is the emitted key', () => {
    expect(buildProviderOptions('openai', 'high', noQuirks, 'opencode')).toEqual({
      opencode: { reasoningEffort: 'max' },
    });
    expect(buildProviderOptions('openai', 'medium', noQuirks, 'zai')).toEqual({
      zai: { reasoningEffort: 'medium' },
    });
    expect(buildProviderOptions('openai', 'low', noQuirks, 'lm_studio')).toEqual({
      lm_studio: { reasoningEffort: 'low' },
    });
  });

  test('canonical openai still emits the openai key with max for high', () => {
    expect(buildProviderOptions('openai', 'high', noQuirks, 'openai')).toEqual({
      openai: { reasoningEffort: 'max' },
    });
  });

  // anthropic/google hardcode their key in the SDK, so the model's provider
  // string does not change it (`gemini` still resolves `providerOptions.google`).
  test('anthropic and google keys are the SDK provider name, not the model provider string', () => {
    expect(buildProviderOptions('google', 'high', noQuirks, 'gemini')).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } },
    });
    expect(buildProviderOptions('anthropic', 'low', noQuirks, 'anthropic')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 }, sendReasoning: true },
    });
  });

  test('a provider name the compatible SDK would truncate fails loudly', () => {
    expect(() => buildProviderOptions('openai', 'high', noQuirks, 'my.endpoint')).toThrow(
      /rename the provider without a '\.'/,
    );
  });
});

describe('toModelMessages', () => {
  test('folds consecutive tool messages into one tool message and resolves toolName', () => {
    const history = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_a', type: 'function', function: { name: 'search', arguments: '{}' } },
          { id: 'call_b', type: 'function', function: { name: 'fetch', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_a', content: 'result-a' },
      { role: 'tool', tool_call_id: 'call_b', content: 'result-b' },
    ] as any;

    const messages = toModelMessages(history);

    expect(messages).toHaveLength(2);
    const toolMessage = messages[1] as any;
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.content).toHaveLength(2);
    expect(toolMessage.content[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'call_a',
      toolName: 'search',
      output: { type: 'text', value: 'result-a' },
    });
    expect(toolMessage.content[1]).toEqual({
      type: 'tool-result',
      toolCallId: 'call_b',
      toolName: 'fetch',
      output: { type: 'text', value: 'result-b' },
    });
  });

  test('throws when a tool_call_id cannot be resolved to a toolName', () => {
    const history = [{ role: 'tool', tool_call_id: 'orphan', content: 'x' }] as any;
    expect(() => toModelMessages(history)).toThrow(/orphan/);
  });

  test('maps image_url content to an image part', () => {
    const history = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        ],
      },
    ] as any;

    const messages = toModelMessages(history);
    expect(messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', image: 'https://example.com/a.png' },
      ],
    });
  });

  test('preserves malformed tool arguments as the raw string', () => {
    const history = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_bad', type: 'function', function: { name: 'search', arguments: '{"bad":' } },
        ],
      },
    ] as any;

    const messages = toModelMessages(history);
    const assistant = messages[0] as any;
    const toolCall = assistant.content.find((p: any) => p.type === 'tool-call');
    expect(toolCall.input).toBe('{"bad":');
  });

  test('passes the _malformed_json marker as a parsed object', () => {
    const history = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_marker',
            type: 'function',
            function: { name: 'search', arguments: '{"_malformed_json":true}' },
          },
        ],
      },
    ] as any;

    const messages = toModelMessages(history);
    const toolCall = (messages[0] as any).content.find((p: any) => p.type === 'tool-call');
    expect(toolCall.input).toEqual({ _malformed_json: true });
  });

  test('round-trips anthropic thinking signatures into reasoning parts', () => {
    const history = [
      {
        role: 'assistant',
        content: 'hi',
        reasoning_content: 'thinking...',
        thinking_blocks: [{ type: 'thinking', thinking: 'block-thought', signature: 'sig-123' }],
      },
    ] as any;

    const messages = toModelMessages(history);
    const reasoning = (messages[0] as any).content.filter((p: any) => p.type === 'reasoning');
    expect(reasoning[0]).toEqual({ type: 'reasoning', text: 'thinking...' });
    expect(reasoning[1]).toEqual({
      type: 'reasoning',
      text: 'block-thought',
      providerOptions: { anthropic: { signature: 'sig-123' } },
    });
  });

  test('round-trips redacted_thinking blocks into reasoning parts', () => {
    const history = [
      {
        role: 'assistant',
        content: 'hi',
        thinking_blocks: [{ type: 'redacted_thinking', data: 'xyz' }],
      },
    ] as any;

    const messages = toModelMessages(history);
    const reasoning = (messages[0] as any).content.filter((p: any) => p.type === 'reasoning');
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].text).toBe('');
    expect(reasoning[0].providerOptions.anthropic.redactedData).toBe('xyz');
    expect(reasoning[0].providerOptions.anthropic.signature).toBeUndefined();
  });
});

describe('runLlmStream', () => {
  test('re-emits text-delta and synthesizes tool-call chunks', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'Hello' },
          { type: 'text-end', id: 't1' },
          { type: 'tool-input-start', id: 'call_1', toolName: 'search' },
          { type: 'tool-input-delta', id: 'call_1', delta: '{"q":"x"}' },
          { type: 'tool-input-end', id: 'call_1' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'search', input: '{"q":"x"}' },
          { type: 'tool-call', toolCallId: 'call_2', toolName: 'other', input: '{"z":1}' },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          },
        ] as any),
      },
    });

    const chunks: any[] = [];
    for await (const chunk of runLlmStream({
      model,
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks.find((c) => c.choices[0].delta.content === 'Hello');
    expect(text).toBeDefined();

    const start1 = chunks.find(
      (c) => c.choices[0].delta.tool_calls?.[0]?.id === 'call_1',
    );
    expect(start1.choices[0].delta.tool_calls[0].function.name).toBe('search');

    // call_2 never received input deltas -> one synthesized start + args.
    const start2 = chunks.find(
      (c) => c.choices[0].delta.tool_calls?.[0]?.id === 'call_2',
    );
    expect(start2.choices[0].delta.tool_calls[0].function.name).toBe('other');

    const argTexts = chunks
      .map((c) => c.choices[0].delta.tool_calls?.[0]?.function?.arguments)
      .filter((a): a is string => typeof a === 'string' && a.length > 0);
    expect(argTexts).toContain('{"q":"x"}');
    expect(argTexts).toContain('{"z":1}');

    const finish = chunks.find((c) => c.choices[0].finish_reason !== null);
    expect(finish.choices[0].finish_reason).toBe('tool_calls');
  });

  test('folds reasoning text + anthropic signature into ONE thinking_blocks delta', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', delta: 'let me ' },
          { type: 'reasoning-delta', id: 'r1', delta: 'think' },
          {
            type: 'reasoning-delta',
            id: 'r1',
            delta: '',
            providerMetadata: { anthropic: { signature: 'sig_abc' } },
          },
          { type: 'reasoning-end', id: 'r1' },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 0, reasoning: 2 },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ] as any),
      },
    });

    const chunks: any[] = [];
    for await (const chunk of runLlmStream({
      model,
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(chunk);
    }

    const blockDeltas = chunks.filter((c) => Array.isArray(c.choices[0].delta.thinking_blocks));
    expect(blockDeltas).toHaveLength(1);
    expect(blockDeltas[0].choices[0].delta.thinking_blocks).toEqual([
      { type: 'thinking', thinking: 'let me think', signature: 'sig_abc' },
    ]);

    const contentDeltas = chunks.filter(
      (c) => typeof c.choices[0].delta.reasoning_content === 'string' &&
        c.choices[0].delta.reasoning_content.length > 0,
    );
    expect(contentDeltas).toHaveLength(0);
  });

  test('emits a single reasoning_content delta when no signature arrives', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'reasoning-start', id: 'r2' },
          { type: 'reasoning-delta', id: 'r2', delta: 'plain ' },
          { type: 'reasoning-delta', id: 'r2', delta: 'thought' },
          { type: 'reasoning-end', id: 'r2' },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 0, reasoning: 2 },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ] as any),
      },
    });

    const chunks: any[] = [];
    for await (const chunk of runLlmStream({
      model,
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(chunk);
    }

    const contentDeltas = chunks.filter(
      (c) => typeof c.choices[0].delta.reasoning_content === 'string' &&
        c.choices[0].delta.reasoning_content.length > 0,
    );
    expect(contentDeltas).toHaveLength(1);
    expect(contentDeltas[0].choices[0].delta.reasoning_content).toBe('plain thought');
    expect(chunks.some((c) => Array.isArray(c.choices[0].delta.thinking_blocks))).toBe(false);
  });
});