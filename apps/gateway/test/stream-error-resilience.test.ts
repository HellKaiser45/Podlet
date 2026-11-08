import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import { runLlmStream } from '../src/llm/stream';

// ---------------------------------------------------------------------------
// `result.warnings` is only awaited on the success path, so a rejection of it
// on any throw path used to be an unhandled rejection -- fatal under Bun, where
// it killed the whole gateway instead of failing one run.
// ---------------------------------------------------------------------------

async function drain(gen: AsyncGenerator<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

describe('a failing provider stream', () => {
  test('surfaces its error and leaks no rejection from warnings', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('provider exploded');
      },
    } as any);

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);

    let thrown: unknown;
    try {
      thrown = await drain(
        runLlmStream({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          onUsage: () => {},
        }),
      ).then(
        () => undefined,
        (e) => e,
      );
      // Give a leaked rejection a turn of the event loop to be reported.
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String((thrown as Error).message)).toContain('provider exploded');
    expect(rejections).toEqual([]);
  });

  test('a stream error mid-flight also leaves no unhandled rejection', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.error(new Error('stream died'));
          },
        }),
      },
    } as any);

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);

    let thrown: unknown;
    try {
      thrown = await drain(
        runLlmStream({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          onUsage: () => {},
        }),
      ).then(
        () => undefined,
        (e) => e,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(rejections).toEqual([]);
  });
});