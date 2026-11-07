import { describe, expect, test, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@podlet/types';
import AppContainer from '../src/runtime';
import type { NormalizedUsage, UsageRecord } from '../src/llm/usage';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function usage(): NormalizedUsage {
  return {
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
    noCacheTokens: undefined,
    reasoningTokens: undefined,
    textTokens: undefined,
    usageReported: true,
    rawJson: '{}',
    rawTruncated: false,
  };
}

function record(): UsageRecord {
  return {
    callId: 'call-sink-1',
    outcome: 'finish',
    finishReason: 'stop',
    usage: usage(),
    runId: 'run-sink',
    frameId: 'frame-sink',
    parentFrameId: undefined,
    agentId: 'coder',
    model: 'fast',
    provider: 'openrouter',
    protocol: 'openai',
    usageRequested: true,
  };
}

async function container(): Promise<AppContainer> {
  const dir = await mkdtemp(join(tmpdir(), 'podlet-sink-'));
  tempDirs.push(dir);
  const config: AppConfig = {
    podletDir: dir,
    dbName: 'podlet.db',
    port: 0,
    host: '127.0.0.1',
    webPort: 0,
    dbPath: join(dir, 'podlet.db'),
    corsOrigin: '*',
    safemode: true,
    vision: { enabled: false, max_edge: 1024, max_images_per_call: 1 },
  };
  return new AppContainer(config);
}

// ---------------------------------------------------------------------------
// A failed usage write must not change the run's outcome.
//
// The sink is fire-and-forget: the caller does not await it, so the rejection
// has to be caught inside the sink. If it escaped, an unhandled rejection
// would take down the process on a working chat.
// ---------------------------------------------------------------------------

describe('the usage sink on a failed write', () => {
  test('returns normally and logs the rejection instead of throwing', async () => {
    const app = await container();
    const failure = new Error('database is locked');
    app.usageManager = {
      record: () => Promise.reject(failure),
    } as unknown as typeof app.usageManager;

    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    let threw: unknown;
    try {
      // Fire-and-forget: the sink must return before the write settles, and it
      // must not throw synchronously.
      app.usageSink(record());
      // Let the rejected promise's handler run.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } catch (e) {
      threw = e;
    } finally {
      console.error = originalError;
    }

    expect(threw).toBeUndefined();
    // Exactly one line, and it names the sink's own message.
    expect(logged).toHaveLength(1);
    expect(String(logged[0]![0])).toContain('[usage] write failed');
  });
});