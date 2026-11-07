import { describe, expect, test, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDB } from '../src/db/db';
import { UsageCRUDClient } from '../src/db/db_usage_client';
import type { NormalizedUsage, UsageRecord } from '../src/llm/usage';
import { AgentClient } from '../src/agent_client';
import ModelsManager from '../src/system/models';
import AgentsManager from '../src/system/agents';
import SkillsManager from '../src/system/skills';
import { VirtualFileSystem } from '../src/system/sandbox';
import type AppContainer from '../src/runtime';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A per-call uuid so two calls never collide on the primary key. */
let seq = 0;

function usage(overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
    noCacheTokens: 8,
    reasoningTokens: 1,
    textTokens: 4,
    usageReported: true,
    rawJson: '{"prompt_tokens":10}',
    rawTruncated: false,
    ...overrides,
  };
}

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    callId: `call-${++seq}`,
    outcome: 'finish',
    finishReason: 'stop',
    usage: usage(),
    runId: 'run-1',
    frameId: 'frame-1',
    parentFrameId: undefined,
    agentId: 'coder',
    model: 'fast',
    provider: 'openrouter',
    protocol: 'openai',
    usageRequested: true,
    ...overrides,
  };
}

function freshClient(): UsageCRUDClient {
  // `createDB(':memory:', ':memory:')` ignores the path and uses an in-memory
  // database; migrations still run off the real drizzle folder.
  return new UsageCRUDClient(createDB(':memory:', ':memory:'));
}

// ---------------------------------------------------------------------------
// 1. The empty run: zeros, and both flags false.
// ---------------------------------------------------------------------------

describe('totals for a run with no calls', () => {
  test('an unknown run returns the zeroed shape, never an error', async () => {
    const totals = await freshClient().totals('no-such-run');

    expect(totals.run).toEqual({
      input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0,
      noCache: 0, reasoning: 0, text: 0, calls: 0,
    });
    expect(totals.byFrame).toEqual([]);
    // `coalesce(sum(...), 0) > 0` is what keeps these real booleans: SUM over
    // zero rows is NULL, and NULL > 0 would surface as null.
    expect(totals.reported).toBe(false);
    expect(totals.requested).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Two frames x three calls.
// ---------------------------------------------------------------------------

describe('two frames, three calls each', () => {
  test('run sums cover both frames and byFrame attributes each one', async () => {
    const client = freshClient();

    for (let i = 0; i < 3; i++) {
      await client.record(record({ runId: 'run-2', frameId: 'root', parentFrameId: undefined, agentId: 'coder' }));
      await client.record(record({ runId: 'run-2', frameId: 'child', parentFrameId: 'root', agentId: 'reviewer' }));
    }

    const totals = await client.totals('run-2');

    expect(totals.run.calls).toBe(6);
    expect(totals.run.input).toBe(60);
    expect(totals.run.output).toBe(30);
    expect(totals.run.total).toBe(90);
    expect(totals.run.cacheRead).toBe(12);
    expect(totals.run.cacheWrite).toBe(6);
    expect(totals.run.noCache).toBe(48);
    expect(totals.run.reasoning).toBe(6);
    expect(totals.run.text).toBe(24);

    expect(totals.byFrame).toHaveLength(2);
    const byFrame = Object.fromEntries(totals.byFrame.map(f => [f.frameId, f]));

    expect(byFrame.root!.calls).toBe(3);
    expect(byFrame.root!.input).toBe(30);
    expect(byFrame.root!.parentFrameId).toBeNull();
    expect(byFrame.root!.agentId).toBe('coder');

    expect(byFrame.child!.calls).toBe(3);
    expect(byFrame.child!.input).toBe(30);
    expect(byFrame.child!.parentFrameId).toBe('root');
    expect(byFrame.child!.agentId).toBe('reviewer');

    expect(totals.reported).toBe(true);
    expect(totals.requested).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. THE CORE PROPERTY: one run id, parent + subagent.
// ---------------------------------------------------------------------------

describe('subagents inherit the root run id', () => {
  test('a parent and a subagent call collapse into ONE run total, two byFrame entries', async () => {
    const client = freshClient();

    await client.record(record({ runId: 'root-run', frameId: 'parent-frame', parentFrameId: undefined, agentId: 'coordinator' }));
    await client.record(record({ runId: 'root-run', frameId: 'subagent-frame', parentFrameId: 'parent-frame', agentId: 'coder' }));

    const totals = await client.totals('root-run');

    // One SUM over run_id already includes every nested subagent.
    expect(totals.run.calls).toBe(2);
    expect(totals.run.input).toBe(20);

    // Per-instance attribution is frame_id + parent_frame_id, never a join.
    expect(totals.byFrame).toHaveLength(2);
    expect(totals.byFrame.map(f => f.frameId)).toEqual(['parent-frame', 'subagent-frame']);
    expect(totals.byFrame[1]!.parentFrameId).toBe('parent-frame');
  });
});

// ---------------------------------------------------------------------------
// 4. The same subagent invoked twice.
// ---------------------------------------------------------------------------

describe('the same subagent invoked twice', () => {
  test('yields TWO byFrame entries (a fresh frame_id per invocation) and one run', async () => {
    const client = freshClient();

    await client.record(record({ runId: 'run-4', frameId: 'parent', parentFrameId: undefined, agentId: 'coordinator' }));
    // Same agent, same parent, different frame: two distinct invocations.
    await client.record(record({ runId: 'run-4', frameId: 'sub-a', parentFrameId: 'parent', agentId: 'coder' }));
    await client.record(record({ runId: 'run-4', frameId: 'sub-b', parentFrameId: 'parent', agentId: 'coder' }));

    const totals = await client.totals('run-4');

    expect(totals.run.calls).toBe(3);
    expect(totals.byFrame).toHaveLength(3);
    expect(totals.byFrame.filter(f => f.agentId === 'coder')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 5. NULL token columns sum as zero.
// ---------------------------------------------------------------------------

describe('a call the provider never reported on', () => {
  test('NULL token columns contribute 0 alongside a normal row', async () => {
    const client = freshClient();

    await client.record(record({ runId: 'run-5', frameId: 'f1' }));
    await client.record(record({
      runId: 'run-5',
      frameId: 'f1',
      outcome: 'error',
      finishReason: 'error',
      usage: usage({
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        noCacheTokens: undefined,
        reasoningTokens: undefined,
        textTokens: undefined,
        usageReported: false,
        rawJson: undefined,
      }),
    }));

    const totals = await client.totals('run-5');

    expect(totals.run.calls).toBe(2);
    // The error row's NULLs are `coalesce(..., 0)`, never poisoning the sum.
    expect(totals.run.input).toBe(10);
    expect(totals.run.total).toBe(15);
    expect(totals.run.cacheRead).toBe(2);
    expect(totals.run.text).toBe(4);
    expect(totals.reported).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. A reported zero is still reported.
// ---------------------------------------------------------------------------

describe('a row with zero tokens', () => {
  test('usage_reported = 1 still yields reported: true', async () => {
    const client = freshClient();

    await client.record(record({
      runId: 'run-6',
      usage: usage({
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, noCacheTokens: 0,
        reasoningTokens: 0, textTokens: 0,
        usageReported: true,
      }),
    }));

    const totals = await client.totals('run-6');

    expect(totals.run.total).toBe(0);
    expect(totals.reported).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Deterministic fan-out ordering, even within one millisecond.
// ---------------------------------------------------------------------------

describe('byFrame ordering', () => {
  test('is deterministic when every row shares the same created_at', async () => {
    const db = createDB(':memory:', ':memory:');
    const client = new UsageCRUDClient(db);

    await client.record(record({ runId: 'run-7', frameId: 'beta', parentFrameId: undefined }));
    await client.record(record({ runId: 'run-7', frameId: 'alpha', parentFrameId: 'beta' }));

    // Pin both rows to the SAME millisecond: `ORDER BY created_at` inside a
    // GROUP BY is SQLite's undefined-bare-column case, so the tie would
    // otherwise pick an arbitrary row.
    db.run(sql`update llm_usage set created_at = 1700000000000 where run_id = 'run-7'`);

    const first = await client.totals('run-7');
    const second = await client.totals('run-7');

    // Whichever order the tie resolves to, it must be the SAME every time.
    expect(first.byFrame.map(f => f.frameId)).toEqual(second.byFrame.map(f => f.frameId));
    expect(first.byFrame.map(f => f.frameId).sort()).toEqual(['alpha', 'beta']);
  });

  test('orders by the earliest call of each frame', async () => {
    const db = createDB(':memory:', ':memory:');
    const client = new UsageCRUDClient(db);

    await client.record(record({ runId: 'run-7b', frameId: 'first' }));
    await client.record(record({ runId: 'run-7b', frameId: 'second' }));
    db.run(sql`update llm_usage set created_at = 1000 where run_id = 'run-7b' and frame_id = 'first'`);
    db.run(sql`update llm_usage set created_at = 2000 where run_id = 'run-7b' and frame_id = 'second'`);
    // A later call in `first` must not move the frame: the aggregate is `min`.
    await client.record(record({ runId: 'run-7b', frameId: 'first' }));
    db.run(sql`update llm_usage set created_at = 3000 where run_id = 'run-7b' and frame_id = 'first' and created_at <> 1000`);

    const totals = await client.totals('run-7b');
    expect(totals.byFrame.map(f => f.frameId)).toEqual(['first', 'second']);
  });
});

// ---------------------------------------------------------------------------
// 8. The primary key is the duplicate guard.
// ---------------------------------------------------------------------------

describe('a duplicate callId', () => {
  test('throws instead of silently overwriting', async () => {
    const client = freshClient();
    const rec = record({ runId: 'run-8' });

    await client.record(rec);
    await expect(client.record(rec)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. Deletion is per run, never per frame.
// ---------------------------------------------------------------------------

describe('deleteByRunId', () => {
  test('removes only that run rows', async () => {
    const client = freshClient();

    await client.record(record({ runId: 'keep', frameId: 'f1' }));
    await client.record(record({ runId: 'drop', frameId: 'f1' }));
    await client.record(record({ runId: 'drop', frameId: 'f2' }));

    await client.deleteByRunId('drop');

    expect((await client.totals('drop')).run.calls).toBe(0);
    expect((await client.totals('keep')).run.calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The sink receives a fully-populated record.
//
// Only what `chatStream` assembles is under test: the transport is replaced by
// a fetch stub answering a legal SSE stream that carries a usage object (the
// same envelope usage-capture.test.ts uses).
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

/**
 * Replace fetch with one that answers a valid SSE stream with usage, and
 * records every request body.
 */
function stubFetch(): Array<Record<string, any>> {
  const bodies: Array<Record<string, any>> = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const encoder = new TextEncoder();
    const payloads = [
      JSON.stringify({
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
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

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.OPENROUTER_API_KEY;
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function runThroughChatStream(
  modelsJson: Record<string, unknown>,
  agent: Record<string, unknown>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'podlet-usage-'));
  tempDirs.push(dir);
  await mkdir(join(dir, 'agents'), { recursive: true });
  await mkdir(join(dir, 'prompts'), { recursive: true });
  await writeFile(join(dir, 'models.json'), JSON.stringify(modelsJson, null, 2));
  await writeFile(join(dir, 'prompts', 'alpha.md'), 'you are alpha');
  await writeFile(join(dir, 'agents', 'alpha.json'), JSON.stringify(agent, null, 2));

  const modelManager = new ModelsManager(dir);
  await modelManager.init();
  const agentManager = new AgentsManager(dir);
  await agentManager.loadAll();

  const bodies = stubFetch();

  const records: UsageRecord[] = [];
  const container = {
    initConfig: { podletDir: dir, vision: { enabled: true } },
    modelManager,
    agentManager,
    skillManager: new SkillsManager(dir),
    mcpManager: { getTools: () => [] },
    agentToolsManager: { getAgentAsToolDefinition: async () => [], isAgentTool: () => false },
    usageSink: (rec: UsageRecord) => { records.push(rec); },
  } as unknown as AppContainer;

  const client = new AgentClient(container);
  const vfs = new VirtualFileSystem(dir, 'root-run-id');

  for await (const _chunk of client.chatStream(
    'alpha',
    [{ role: 'user', content: 'hi' } as any],
    vfs,
    { runId: 'root-run-id', frameId: 'frame-xyz', parentFrameId: 'parent-abc' },
  )) {
    // drain
  }

  return { records, bodies };
}

describe('chatStream assembles a fully-populated UsageRecord', () => {
  test('model is the models.json key, and usageRequested is computed true', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';

    const { records, bodies } = await runThroughChatStream(
      { fast: { provider: 'openrouter', model: 'google/gemma-test' } },
      { agentId: 'alpha', agentDescription: 'a', model: 'fast', system_prompt: 'alpha.md' },
    );

    expect(records).toHaveLength(1);
    const rec = records[0]!;

    // The models.json KEY, not the provider name and not `openrouter.chat`.
    expect(rec.model).toBe('fast');
    expect(rec.provider).toBe('openrouter');
    expect(rec.protocol).toBe('openai');
    // Computed from the resolved quirk: openrouter does ask for usage.
    expect(rec.usageRequested).toBe(true);
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true });

    // The ROOT run id, never re-minted here.
    expect(rec.runId).toBe('root-run-id');
    expect(rec.frameId).toBe('frame-xyz');
    expect(rec.parentFrameId).toBe('parent-abc');
    expect(rec.agentId).toBe('alpha');
    expect(rec.callId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(rec.outcome).toBe('finish');
    expect(rec.finishReason).toBe('stop');
    expect(rec.usage.inputTokens).toBe(42);
    expect(rec.usage.outputTokens).toBe(7);
  });

  test('usageRequested is false when the endpoint declares no_stream_options', async () => {
    const { records, bodies } = await runThroughChatStream(
      { local: { provider: 'ollama', model: 'qwen2.5' } },
      { agentId: 'alpha', agentDescription: 'a', model: 'local', system_prompt: 'alpha.md' },
    );

    expect(records).toHaveLength(1);
    expect(records[0]!.model).toBe('local');
    expect(records[0]!.provider).toBe('ollama');
    // Computed from the resolved quirk, never a constant.
    expect(records[0]!.usageRequested).toBe(false);
    expect('stream_options' in bodies[0]!).toBe(false);
  });
});