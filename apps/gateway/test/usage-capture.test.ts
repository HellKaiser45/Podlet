import { describe, expect, test, afterEach } from 'bun:test';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { buildLanguageModel, requestsUsage } from '../src/llm/provide';
import { runLlmStream, mapFinishReason } from '../src/llm/stream';
import { normalizeUsage } from '../src/llm/usage';
import type { LlmCallOutcome } from '../src/llm/usage';
import { PROVIDER_TABLE, resolveModel } from '../src/system/providers';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Replace fetch with one that records every request body and answers a valid
 * SSE stream carrying a usage object. Copied from dispatch-guard.test.ts, whose
 * `countFetches` is module-local and whose envelope is not a legal usage chunk.
 */
function captureFetchBodies(): Array<Record<string, any>> {
  const bodies: Array<Record<string, any>> = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const encoder = new TextEncoder();
    const payloads = [
      JSON.stringify({
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
      }),
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

const OPENROUTER_ENV = { OPENROUTER_API_KEY: 'sk-test' };

function openRouterModel(entry: Record<string, unknown>) {
  const resolved = resolveModel('probe', entry, OPENROUTER_ENV);
  expect(resolved.health.status).toBe('ok');
  return buildLanguageModel('openrouter', resolved, 'test/model');
}

async function drain(gen: AsyncGenerator<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

/** Collects every outcome the adapter reports. */
function collector(): { outcomes: LlmCallOutcome[]; onUsage: (o: LlmCallOutcome) => void } {
  const outcomes: LlmCallOutcome[] = [];
  return { outcomes, onUsage: (o) => outcomes.push(o) };
}

const STOP_FINISH = {
  type: 'finish',
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  finishReason: { unified: 'stop', raw: 'stop' },
};

// ---------------------------------------------------------------------------
// 1. include_usage must reach the wire, or every usage column stays NULL.
// ---------------------------------------------------------------------------

describe('include_usage on the wire', () => {
  test('an openrouter-shaped model sends stream_options.include_usage', async () => {
    const bodies = captureFetchBodies();
    const model = openRouterModel({ provider: 'openrouter', model: 'test/model' });
    const { outcomes, onUsage } = collector();

    await drain(runLlmStream({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      onUsage,
    }));

    expect(bodies).toHaveLength(1);
    expect(bodies[0].stream_options).toEqual({ include_usage: true });
    // And the usage the provider sent back is what got captured.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].usage.usageReported).toBe(true);
    expect(outcomes[0].usage.inputTokens).toBe(11);
    expect(outcomes[0].usage.outputTokens).toBe(4);
  });

  test('a model declaring no_stream_options omits stream_options entirely', async () => {
    const bodies = captureFetchBodies();
    const model = openRouterModel({
      provider: 'openrouter',
      model: 'test/model',
      quirks: { no_stream_options: true },
    });
    const { onUsage } = collector();

    await drain(runLlmStream({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      onUsage,
    }));

    expect(bodies).toHaveLength(1);
    expect('stream_options' in bodies[0]).toBe(false);
    expect(bodies[0].stream_options).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Exactly one report per call, whatever the termination.
// ---------------------------------------------------------------------------

describe('onUsage fires exactly once per call', () => {
  test('normal finish reports outcome "finish"', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'hello' },
          { type: 'text-end', id: 't1' },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 2, text: 2, reasoning: 0 },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ] as any),
      },
    });
    const { outcomes, onUsage } = collector();

    await drain(runLlmStream({ model, messages: [{ role: 'user', content: 'hi' }], onUsage }));

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('finish');
    expect(outcomes[0].finishReason).toBe('stop');
    expect(outcomes[0].usage.inputTokens).toBe(5);
  });

  test('an error part reports outcome "error" and still throws', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'error', error: new Error('provider exploded') },
        ] as any),
      },
    });
    const { outcomes, onUsage } = collector();

    await expect(
      drain(runLlmStream({ model, messages: [{ role: 'user', content: 'hi' }], onUsage })),
    ).rejects.toThrow('provider exploded');

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('error');
    expect(outcomes[0].finishReason).toBe('error');
    expect(outcomes[0].usage.usageReported).toBe(false);
  });

  test('a mid-stream throw reaches the caller as "incomplete"', async () => {
    // The adapter's own mid-stream throw: a tool-input-delta for an id it never
    // saw. Erroring a ReadableStream directly is reported as an uncaught Bun
    // failure, so the adapter's own throw path is used instead — the same loss
    // path the plan names (stream.ts's unknown tool-input-id throw).
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'partial' },
          { type: 'tool-input-delta', id: 'never-started', delta: '{}' },
        ] as any),
      },
    });
    const { outcomes, onUsage } = collector();

    await expect(
      drain(runLlmStream({ model, messages: [{ role: 'user', content: 'hi' }], onUsage })),
    ).rejects.toThrow("tool-input-delta for unknown tool input id 'never-started'");

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('incomplete');
    expect(outcomes[0].finishReason).toBe('incomplete');
    expect(outcomes[0].usage.usageReported).toBe(false);
  });

  test('a stream the provider never finishes reports outcome "incomplete"', async () => {
    // No `finish` part at all: the provider closes the stream mid-flight.
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'truncated' },
          { type: 'text-end', id: 't1' },
        ] as any),
      }),
    });
    const { outcomes, onUsage } = collector();

    await drain(runLlmStream({ model, messages: [{ role: 'user', content: 'hi' }], onUsage }));

    // The SDK synthesizes a `finish` part when the stream closes without one,
    // and leaves `rawFinishReason` undefined on it. That must NOT be recorded
    // as a successful `finish`: the call never finished.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('incomplete');
    expect(outcomes[0].finishReason).toBe('incomplete');
    expect(outcomes[0].usage.usageReported).toBe(false);
  });

  test('a genuine provider finish is still recorded as "finish"', async () => {
    // The counterpart to the test above: a real finish part carries a string
    // `rawFinishReason`, so the synthesized/absent distinction is what decides.
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'done' },
          { type: 'text-end', id: 't1' },
          STOP_FINISH,
        ] as any),
      },
    });
    const { outcomes, onUsage } = collector();

    await drain(runLlmStream({ model, messages: [{ role: 'user', content: 'hi' }], onUsage }));

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('finish');
    expect(outcomes[0].finishReason).toBe('stop');
  });

  test('a caller breaking out early reports outcome "incomplete" once', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'one' },
          { type: 'text-delta', id: 't1', delta: 'two' },
          { type: 'text-end', id: 't1' },
          STOP_FINISH,
        ] as any),
      },
    });
    const { outcomes, onUsage } = collector();

    for await (const chunk of runLlmStream({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      onUsage,
    })) {
      if (chunk) break;
    }

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('incomplete');
  });

  test('returning after a finish does not double-report', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ] as any),
      },
    });
    const { outcomes, onUsage } = collector();

    for await (const chunk of runLlmStream({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      onUsage,
    })) {
      // chat-loop returns on the terminal chunk, which drops the generator.
      if (chunk.choices[0].finish_reason !== null) break;
    }

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('finish');
  });
});

// ---------------------------------------------------------------------------
// 3. A throwing sink must not kill an already-billed call.
// ---------------------------------------------------------------------------

describe('a throwing onUsage callback', () => {
  test('still yields the terminal chunk and logs exactly once', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'hi' },
          { type: 'text-end', id: 't1' },
          STOP_FINISH,
        ] as any),
      },
    });

    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    let chunks: any[];
    try {
      chunks = await drain(runLlmStream({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        onUsage: () => {
          throw new Error('sink is down');
        },
      }));
    } finally {
      console.error = originalError;
    }

    const finish = chunks.find((c) => c.choices[0].finish_reason !== null);
    expect(finish).toBeDefined();
    expect(finish.choices[0].finish_reason).toBe('stop');

    expect(logged).toHaveLength(1);
    expect(String(logged[0][0])).toContain('[llm] usage callback threw');
  });

  test('a raw payload that cannot be serialized still records exactly one outcome', async () => {
    // `JSON.stringify` throws on a BigInt. The record must not vanish: the
    // row degrades to `incomplete` (a truthful label) and the terminal chunk
    // is still yielded.
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'hi' },
          { type: 'text-end', id: 't1' },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 2, text: 2, reasoning: 0 },
              raw: { unserializable: 1n },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ] as any),
      },
    });
    const { outcomes, onUsage } = collector();

    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    let chunks: any[];
    try {
      chunks = await drain(runLlmStream({ model, messages: [{ role: 'user', content: 'hi' }], onUsage }));
    } finally {
      console.error = originalError;
    }

    // Exactly one report, and it is NOT silently dropped.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('incomplete');
    expect(outcomes[0].finishReason).toBe('incomplete');
    expect(outcomes[0].usage.usageReported).toBe(false);
    expect(outcomes[0].callId).toBeString();

    // The terminal chunk chat-loop switches on is unaffected.
    const finish = chunks.find((c) => c.choices[0].finish_reason !== null);
    expect(finish).toBeDefined();
    expect(finish.choices[0].finish_reason).toBe('stop');

    // Both the (non-fatal) log line and the normalization failure were reported.
    expect(logged.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. The stored finish reason is the mapped one, never the raw SDK literal.
// ---------------------------------------------------------------------------

describe('finishReason mapping', () => {
  test('a tool-calls finish records finish_reason "tool_calls", not "tool-calls"', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'call_1', toolName: 'search' },
          { type: 'tool-input-delta', id: 'call_1', delta: '{}' },
          { type: 'tool-input-end', id: 'call_1' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'search', input: '{}' },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 0, reasoning: 0 },
            },
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          },
        ] as any),
      },
    });
    const { outcomes, onUsage } = collector();

    const chunks = await drain(runLlmStream({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      onUsage,
    }));

    expect(outcomes[0].finishReason).toBe('tool_calls');
    // The terminal chunk and the record cannot disagree.
    const finish = chunks.find((c) => c.choices[0].finish_reason !== null);
    expect(finish.choices[0].finish_reason).toBe(outcomes[0].finishReason);
  });

  test('content-filter maps to content_filter and anything else passes through', () => {
    expect(mapFinishReason('content-filter')).toBe('content_filter');
    expect(mapFinishReason('length')).toBe('length');
    expect(mapFinishReason('stop')).toBe('stop');
    expect(mapFinishReason('other' as any)).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// 5. normalizeUsage: absence is never zero.
// ---------------------------------------------------------------------------

describe('normalizeUsage', () => {
  test('an all-undefined usage keeps every field undefined and reports nothing', () => {
    const usage = normalizeUsage(undefined);

    expect(usage.inputTokens).toBeUndefined();
    expect(usage.outputTokens).toBeUndefined();
    expect(usage.totalTokens).toBeUndefined();
    expect(usage.cacheReadTokens).toBeUndefined();
    expect(usage.cacheWriteTokens).toBeUndefined();
    expect(usage.noCacheTokens).toBeUndefined();
    expect(usage.reasoningTokens).toBeUndefined();
    expect(usage.textTokens).toBeUndefined();
    expect(usage.usageReported).toBe(false);
    expect(usage.rawJson).toBeUndefined();
    expect(usage.rawTruncated).toBe(false);
  });

  test('a partial usage passes the reported fields through untouched', () => {
    const usage = normalizeUsage({
      inputTokens: 7,
      outputTokens: undefined,
      totalTokens: undefined,
      inputTokenDetails: { noCacheTokens: 3, cacheReadTokens: 4, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    } as any);

    expect(usage.inputTokens).toBe(7);
    expect(usage.outputTokens).toBeUndefined();
    expect(usage.noCacheTokens).toBe(3);
    expect(usage.cacheReadTokens).toBe(4);
    expect(usage.cacheWriteTokens).toBeUndefined();
    // No `raw` -> the provider did not produce a usage object we can trust.
    expect(usage.usageReported).toBe(false);
  });

  test('a fully-reported usage serializes raw and is usageReported', () => {
    const raw = { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 };
    const usage = normalizeUsage({
      inputTokens: 9,
      outputTokens: 2,
      totalTokens: 11,
      inputTokenDetails: { noCacheTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
      raw,
    } as any);

    expect(usage.usageReported).toBe(true);
    expect(JSON.parse(usage.rawJson!)).toEqual(raw);
    expect(usage.rawTruncated).toBe(false);
  });

  // By design, not a bug: anthropic pre-seeds a zero accumulator and ends with
  // `raw: rawUsage ?? usage`, so `raw` is NEVER undefined there.
  test('anthropic zero usage reports usageReported === true BY SDK DESIGN', () => {
    const usage = normalizeUsage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      raw: { input_tokens: 0, output_tokens: 0 },
    } as any);

    expect(usage.usageReported).toBe(true);
    expect(usage.inputTokens).toBe(0);
  });

  test('a raw payload over 64 KB is replaced with valid JSON and flagged', () => {
    const huge = { blob: 'x'.repeat(70000) };
    const usage = normalizeUsage({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
      raw: huge,
    } as any);

    expect(usage.rawTruncated).toBe(true);
    expect(usage.usageReported).toBe(true);
    const parsed = JSON.parse(usage.rawJson!);
    expect(parsed.__truncated).toBe(true);
    expect(parsed.originalLength).toBeGreaterThan(65536);
    expect(usage.rawJson!.length).toBeLessThan(65536);
  });

  test('the cap is measured in UTF-8 bytes, not UTF-16 code units', () => {
    // Height 40000 is 40000 code units but 80000 UTF-8 bytes, so a payload that
    // is over the 64 KiB BYTE cap slips under a code-unit comparison.
    const blob = '\u00e9'.repeat(40000);
    expect(blob.length).toBe(40000);
    expect(Buffer.byteLength(blob, 'utf8')).toBe(80000);

    const usage = normalizeUsage({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      raw: { blob },
    } as any);

    expect(usage.rawTruncated).toBe(true);
    const parsed = JSON.parse(usage.rawJson!);
    expect(parsed.__truncated).toBe(true);
    // `originalLength` is the BYTE length, the same unit as the cap.
    expect(parsed.originalLength).toBeGreaterThan(65536);
  });

  test('raw: null carries no usage information', () => {
    const usage = normalizeUsage({
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6,
      raw: null,
    } as any);

    // "null" is not a usage object: reporting it as one would claim the
    // provider answered when it said nothing.
    expect(usage.usageReported).toBe(false);
    expect(usage.rawJson).toBeUndefined();
    // The numeric fields still pass through untouched.
    expect(usage.inputTokens).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 6. The three endpoint rows that reject unknown fields must opt out.
// ---------------------------------------------------------------------------

describe('no_stream_options provider rows', () => {
  test('resolveModel("ollama", …) declares no_stream_options', () => {
    const resolved = resolveModel('qwen', { provider: 'ollama', model: 'qwen2.5' }, {});
    expect(resolved.health.status).toBe('ok');
    expect(resolved.quirks.no_stream_options).toBe(true);
  });

  test('resolveModel("lm_studio", …) declares no_stream_options', () => {
    const resolved = resolveModel('local', { provider: 'lm_studio', model: 'local-model' }, {});
    expect(resolved.health.status).toBe('ok');
    expect(resolved.quirks.no_stream_options).toBe(true);
  });

  test('the opencode row carries BOTH opencode_session and no_stream_options', () => {
    expect(PROVIDER_TABLE.opencode.quirks?.opencode_session).toBe(true);
    expect(PROVIDER_TABLE.opencode.quirks?.no_stream_options).toBe(true);

    // opencode declares no row-level base_url, so an entry must supply one.
    const resolved = resolveModel(
      'oc',
      { provider: 'opencode', model: 'big-pickle', base_url: 'https://opencode.ai/zen/v1' },
      { OPENCODE_API_KEY: 'sk-test' },
    );
    expect(resolved.health.status).toBe('ok');
    expect(resolved.quirks.opencode_session).toBe(true);
    expect(resolved.quirks.no_stream_options).toBe(true);
  });

  test('an opencode.ai endpoint reached under another provider name keeps BOTH quirks', () => {
    // `isOpencode` matches on base_url as well as name, because opencode can be
    // configured as a generic openai-compatible provider. Merging only the
    // ROW's quirks would drop `no_stream_options` here and reintroduce the
    // 400-on-every-call regression the quirk exists to prevent.
    const resolved = resolveModel(
      'oc-renamed',
      { provider: 'moonshot', model: 'kimi', base_url: 'https://opencode.ai/v1' },
      { MOONSHOT_API_KEY: 'sk-test' },
    );
    expect(resolved.health.status).toBe('ok');
    expect(resolved.quirks.opencode_session).toBe(true);
    expect(resolved.quirks.no_stream_options).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. `usageRequested` must describe the WIRE, not the config.
// ---------------------------------------------------------------------------

describe('requestsUsage', () => {
  test('the canonical OpenAI factory always asks, whatever the quirk says', () => {
    // createOpenAI hardcodes `stream_options.include_usage: true` and ignores
    // the quirk, so recording "we never asked" here would contradict the wire.
    expect(requestsUsage('openai', 'openai', { no_stream_options: true })).toBe(true);
  });

  test('a third-party openai-compatible endpoint honors the quirk', () => {
    expect(requestsUsage('openai', 'openrouter', { no_stream_options: true })).toBe(false);
  });

  test('a third-party endpoint without the quirk does ask', () => {
    expect(requestsUsage('openai', 'openrouter', {})).toBe(true);
  });
});