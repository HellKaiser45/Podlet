import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { mapReasoning } from '../src/llm/thinking';
import { computeConversationId, opencodeSessionId, stableStringify } from '../src/llm/conversation';
import { countCacheBreakpoints, MAX_CACHE_BREAKPOINTS, toToolSet, withCacheControl } from '../src/llm/messages';
import { PROVIDER_TABLE, resolveModel } from '../src/system/providers';
import type { LiteLLMMessage, Protocol } from '../src/types';

const noQuirks = {};

describe('tier -> reasoning mapping', () => {
  const protocols: Protocol[] = ['openai', 'anthropic', 'google'];

  test('low and medium map to themselves on every protocol', () => {
    for (const protocol of protocols) {
      expect({ protocol, low: mapReasoning(protocol, 'low', noQuirks) }).toEqual({ protocol, low: 'low' });
      expect({ protocol, medium: mapReasoning(protocol, 'medium', noQuirks) }).toEqual({ protocol, medium: 'medium' });
    }
  });

  test('high maps to max for openai and anthropic, high for google', () => {
    expect(mapReasoning('openai', 'high', noQuirks)).toBe('max');
    expect(mapReasoning('anthropic', 'high', noQuirks)).toBe('max');
    expect(mapReasoning('google', 'high', noQuirks)).toBe('high');
  });

  test('none and undefined omit the option entirely', () => {
    for (const protocol of protocols) {
      expect(mapReasoning(protocol, 'none', noQuirks)).toBeUndefined();
      expect(mapReasoning(protocol, undefined, noQuirks)).toBeUndefined();
    }
  });

  test('no_reasoning_effort throws rather than dropping the tier', () => {
    expect(() => mapReasoning('openai', 'high', { no_reasoning_effort: true })).toThrow(
      /rejects reasoning_effort/,
    );
    // `none` is unaffected: nothing was requested.
    expect(mapReasoning('openai', 'none', { no_reasoning_effort: true })).toBeUndefined();
  });
});

const userTurn = (content: string | unknown[]): LiteLLMMessage =>
  ({ role: 'user', content } as LiteLLMMessage);

describe('conversation id derivation', () => {
  test('string content hashes the raw UTF-8 bytes', () => {
    const id = computeConversationId([userTurn('hello')]);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    // sha256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(id).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e');
  });

  test('array content is key-order independent', () => {
    const a = computeConversationId([userTurn([{ type: 'text', text: 'hi' }])]);
    const b = computeConversationId([userTurn([{ text: 'hi', type: 'text' }])]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  test('nested keys are sorted too', () => {
    // Intentionally not valid messages: only the key order is under test here.
    const left = { role: 'user', content: [{ a: 1, b: { c: 2, d: 3 } }] } as unknown as LiteLLMMessage;
    const right = { content: [{ b: { d: 3, c: 2 }, a: 1 }], role: 'user' } as unknown as LiteLLMMessage;
    expect(computeConversationId([left])).toBe(computeConversationId([right]));
  });

  test('stableStringify sorts keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  test('empty history is the literal default', () => {
    expect(computeConversationId([])).toBe('default');
    expect(computeConversationId([{ role: 'system', content: 'sys' } as LiteLLMMessage])).toBe('default');
  });

  test('the first non-system message decides, so different first turns differ', () => {
    const first = computeConversationId([
      { role: 'system', content: 'sys' } as LiteLLMMessage,
      userTurn('one'),
    ]);
    const second = computeConversationId([
      { role: 'system', content: 'sys' } as LiteLLMMessage,
      userTurn('two'),
    ]);
    expect(first).not.toBe(second);
  });
});

describe('opencode session header', () => {
  test('has the ses_<id> shape', () => {
    const id = computeConversationId([userTurn('hello')]);
    const header = opencodeSessionId(id);
    expect(header).toBe(`ses_${id}`);
    expect(header).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  test('falls back to ses_default for an empty history', () => {
    expect(opencodeSessionId(computeConversationId([]))).toBe('ses_default');
  });

  test('the opencode row declares the quirk; no other row does', () => {
    expect(PROVIDER_TABLE.opencode.quirks?.opencode_session).toBe(true);
    for (const [name, row] of Object.entries(PROVIDER_TABLE)) {
      if (name === 'opencode') continue;
      expect({ name, quirk: row.quirks?.opencode_session }).toEqual({ name, quirk: undefined });
    }
  });

  test('a base_url pointing at opencode.ai is treated as opencode', () => {
    const resolved = resolveModel(
      'm',
      { provider: 'custom-openai-clone', model: 'x', api_key_name: 'K' },
      { K: 'k' },
    );
    // unknown provider is still terminal; the base_url rule applies to known rows
    expect(resolved.health.status).toBe('unusable');

    const viaUrl = resolveModel(
      'm',
      { provider: 'moonshot', model: 'x', base_url: 'https://opencode.ai/v1' },
      { MOONSHOT_API_KEY: 'k' },
    );
    expect(viaUrl.health.status).toBe('ok');
    expect(viaUrl.quirks.opencode_session).toBe(true);
  });

  test('User-Agent is set on every provider row', () => {
    for (const name of Object.keys(PROVIDER_TABLE)) {
      const resolved = resolveModel(
        'm',
        { provider: name, model: 'x', api_key_optional: true },
        {},
      );
      if (resolved.health.status !== 'ok') continue;
      expect({ name, ua: resolved.headers['User-Agent'] }).toEqual({ name, ua: 'Podlet/1.0' });
    }
  });
});

describe('strict tool definitions', () => {
  test('toToolSet marks every tool strict', () => {
    const set = toToolSet([
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'writes a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
      {
        type: 'function',
        function: { name: 'no_params' },
      },
    ] as any);

    expect(Object.keys(set).sort()).toEqual(['no_params', 'write_file']);
    for (const [name, definition] of Object.entries(set)) {
      expect({ name, strict: (definition as any).strict }).toEqual({ name, strict: true });
    }
  });

  test('an empty tool list yields an empty set', () => {
    expect(toToolSet(undefined)).toEqual({});
    expect(toToolSet([])).toEqual({});
  });
});

describe('anthropic cache breakpoints', () => {
  const systemParts = { stable: 'SKILLS + PROMPT', volatile: 'CONTEXT TREE' };
  const history: ModelMessage[] = [
    { role: 'user', content: 'first turn' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second turn' },
  ];

  test('the stable prompt part carries cacheControl, the context tree does not', () => {
    const messages = withCacheControl(history, systemParts, noQuirks);

    const systems = messages.filter((message) => message.role === 'system') as Array<{
      content: string;
      providerOptions?: any;
    }>;
    expect(systems).toHaveLength(2);
    expect(systems[0]!.content).toBe('SKILLS + PROMPT');
    expect(systems[0]!.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    expect(systems[1]!.content).toBe('CONTEXT TREE');
    expect(systems[1]!.providerOptions).toBeUndefined();
  });

  test('the last message carries a breakpoint', () => {
    const messages = withCacheControl(history, systemParts, noQuirks);
    expect(countCacheBreakpoints(messages)).toBe(2);
    const last = messages[messages.length - 1] as { role: string; content: any };
    expect(last.role).toBe('user');
    expect(last.content[last.content.length - 1].providerOptions.anthropic.cacheControl)
      .toEqual({ type: 'ephemeral' });
  });

  test('total breakpoints never exceed the provider limit', () => {
    const messages = withCacheControl(history, systemParts, noQuirks);
    expect(countCacheBreakpoints(messages)).toBeLessThanOrEqual(MAX_CACHE_BREAKPOINTS);
    expect(MAX_CACHE_BREAKPOINTS).toBe(4);
  });

  test('no_cache_control leaves the payload untouched', () => {
    const messages = withCacheControl(history, systemParts, { no_cache_control: true });
    expect(messages).toEqual(history);
    expect(countCacheBreakpoints(messages)).toBe(0);
  });

  test('the input history is not mutated', () => {
    const before = JSON.stringify(history);
    withCacheControl(history, systemParts, noQuirks);
    expect(JSON.stringify(history)).toBe(before);
  });
});