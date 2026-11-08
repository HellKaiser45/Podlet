import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { ModelMessage } from 'ai';
import { VirtualFileSystem } from '../src/system/sandbox';
import { CoreToolsManager } from '../src/tools/core/core_tools';
import { hydrateVisionHistory } from '../src/system/vision-hydrate';
import { toModelMessages } from '../src/llm/messages';
import type { LiteLLMMessage } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures: a real image in the VFS, and the receipt JSON that see_image
// actually produces for it.
// ---------------------------------------------------------------------------

const runId = 'run-vision-hydrate';
let podletDir: string;
let vfs: VirtualFileSystem;
let tools: CoreToolsManager;

function makePng(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  try {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#204a87';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 1, Math.max(1, width - 2), Math.max(1, height - 2));
    return new Uint8Array(canvas.toBuffer('image/png'));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

beforeAll(async () => {
  podletDir = await mkdtemp(join(tmpdir(), 'podlet-vision-hydrate-'));
  const artifacts = join(podletDir, 'runs', runId, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'photo.png'), makePng(64, 64));
  await writeFile(join(artifacts, 'photo2.png'), makePng(48, 32));
  await writeFile(join(artifacts, 'notes.txt'), 'hello notes');

  vfs = new VirtualFileSystem(podletDir, runId);
  tools = new CoreToolsManager(vfs);
});

afterAll(async () => {
  await rm(podletDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// History builders
// ---------------------------------------------------------------------------

type Call = [id: string, name: string, args: Record<string, unknown>];

function assistant(calls: Call[]): LiteLLMMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: calls.map(([id, name, args]) => ({
      id,
      type: 'function' as const,
      function: { name, arguments: JSON.stringify(args) },
    })),
  } as unknown as LiteLLMMessage;
}

function toolMessage(id: string, content: string): LiteLLMMessage {
  return { role: 'tool', tool_call_id: id, content } as unknown as LiteLLMMessage;
}

/** Run the real see_image tool so the tool content is a genuine receipt. */
async function seeImage(id: string, paths: string[]): Promise<LiteLLMMessage> {
  const message = await tools.execute('see_image', id, { paths });
  return message as unknown as LiteLLMMessage;
}

function imageMessageCount(history: LiteLLMMessage[]): number {
  let count = 0;
  for (const message of history) {
    if (message.role !== 'user') continue;
    if (!Array.isArray(message.content)) continue;
    count += message.content.filter((part) => part.type === 'image_url').length;
  }
  return count;
}

function hydrationHeaders(history: LiteLLMMessage[]): string[] {
  const headers: string[] = [];
  for (const message of history) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    const first = message.content[0] as { type?: string; text?: string };
    if (first?.type === 'text' && typeof first.text === 'string') {
      headers.push(first.text.split('\n')[0]!);
    }
  }
  return headers;
}

function userContent(message: ModelMessage): Array<Record<string, unknown>> {
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];
}

/** Compact view of the produced messages, with payloads truncated. */
function summarise(messages: ModelMessage[]): string[] {
  return messages.map((message) => {
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') return `${message.role}: ${content}`;
    if (!Array.isArray(content)) return message.role;
    const parts = (content as Array<Record<string, unknown>>).map((part) => {
      const type = String(part.type);
      if (type === 'text') return `text(${String(part.text).split('\n')[0]!.slice(0, 80)})`;
      if (type === 'image') return `image(${String(part.image).slice(0, 24)}…)`;
      if (type === 'tool-result') return `tool-result(${String(part.toolCallId)})`;
      if (type === 'tool-call') return `tool-call(${String(part.toolCallId)})`;
      return type;
    });
    return `${message.role}[${parts.join(' | ')}]`;
  });
}
// ---------------------------------------------------------------------------
// 1. see_image alongside another tool: the image message must land after the
//    whole tool block, never between two tool results.
// ---------------------------------------------------------------------------

describe('hydration ordering with a mixed tool run', () => {
  const buildHistory = async (): Promise<LiteLLMMessage[]> => [
    assistant([
      ['call_see', 'see_image', { paths: ['artifacts/photo.png'] }],
      ['call_read', 'read_file', { paths: ['artifacts/notes.txt'] }],
    ]),
    await seeImage('call_see', ['artifacts/photo.png']),
    toolMessage('call_read', JSON.stringify({ 'artifacts/notes.txt': 'hello notes' })),
  ];

  test('tool results stay contiguous and the image message follows them', async () => {
    const history = await buildHistory();
    const hydrated = await hydrateVisionHistory(history, vfs);

    // assistant -> tool -> tool -> user
    expect(hydrated.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'user']);

    const modelMessages = toModelMessages(hydrated);
    expect(modelMessages.map((m) => m.role)).toEqual(['assistant', 'tool', 'user']);

    // BOTH tool results live in ONE tool message.
    const toolBlock = modelMessages[1]!;
    const results = (toolBlock as { content?: unknown }).content;
    expect(Array.isArray(results)).toBe(true);
    const parts = results as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(2);
    expect(parts.map((part) => part.toolCallId)).toEqual(['call_see', 'call_read']);

    // The image message comes after that tool block, text part first.
    const imageMessage = modelMessages[2]!;
    const content = userContent(imageMessage);
    expect(content.map((part) => part.type)).toEqual(['text', 'image']);
    expect(String(content[0]!.text).startsWith('Images from see_image call call_see:')).toBe(true);
    expect(String(content[1]!.image).startsWith('data:image/png;base64,')).toBe(true);

    // The caller's history is not mutated.
    expect(history.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool']);

    console.log('[vision-hydrate] ModelMessage ordering:', summarise(modelMessages));
  });
});

// ---------------------------------------------------------------------------
// 2. Two see_image results in one run produce two hydration messages, both
//    after the tool block and in their original relative order.
// ---------------------------------------------------------------------------

describe('two see_image results in one run', () => {
  test('both hydration messages follow the tool block, in order', async () => {
    const history: LiteLLMMessage[] = [
      assistant([
        ['call_a', 'see_image', { paths: ['artifacts/photo.png'] }],
        ['call_b', 'see_image', { paths: ['artifacts/photo2.png'] }],
      ]),
      await seeImage('call_a', ['artifacts/photo.png']),
      await seeImage('call_b', ['artifacts/photo2.png']),
    ];

    const hydrated = await hydrateVisionHistory(history, vfs);

    expect(hydrated.map((m) => m.role)).toEqual([
      'assistant', 'tool', 'tool', 'user', 'user',
    ]);
    expect(imageMessageCount(hydrated)).toBe(2);

    const headers = hydrationHeaders(hydrated);
    expect(headers[0]!.startsWith('Images from see_image call call_a:')).toBe(true);
    expect(headers[1]!.startsWith('Images from see_image call call_b:')).toBe(true);

    // Consecutive user messages are accepted by the converter.
    expect(toModelMessages(hydrated).map((m) => m.role)).toEqual([
      'assistant', 'tool', 'user', 'user',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotency: a second pass duplicates nothing, and an old-style hydration
//    message sitting between two tool results is moved out of the run.
// ---------------------------------------------------------------------------

describe('idempotency and legacy placement', () => {
  test('hydrating twice keeps exactly one image message per receipt', async () => {
    const history: LiteLLMMessage[] = [
      assistant([
        ['call_see', 'see_image', { paths: ['artifacts/photo.png'] }],
        ['call_read', 'read_file', { paths: ['artifacts/notes.txt'] }],
      ]),
      await seeImage('call_see', ['artifacts/photo.png']),
      toolMessage('call_read', JSON.stringify({ 'artifacts/notes.txt': 'hello notes' })),
    ];

    const once = await hydrateVisionHistory(history, vfs);
    const twice = await hydrateVisionHistory(once, vfs);

    expect(imageMessageCount(once)).toBe(1);
    expect(imageMessageCount(twice)).toBe(imageMessageCount(once));
    expect(twice.map((m) => m.role)).toEqual(once.map((m) => m.role));
  });

  test('a hydration message left between two tool results is moved after the run', async () => {
    const [assistantMessage, seeReceipt, readReceipt] = [
      assistant([
        ['call_see', 'see_image', { paths: ['artifacts/photo.png'] }],
        ['call_read', 'read_file', { paths: ['artifacts/notes.txt'] }],
      ]),
      await seeImage('call_see', ['artifacts/photo.png']),
      toolMessage('call_read', JSON.stringify({ 'artifacts/notes.txt': 'hello notes' })),
    ];

    const alreadyHydrated = await hydrateVisionHistory(
      [assistantMessage, seeReceipt, readReceipt],
      vfs,
    );
    const legacyHydration = alreadyHydrated[3]!;
    expect(legacyHydration.role).toBe('user');

    // The pre-fix layout: the user message landed between the two tool results.
    const legacy: LiteLLMMessage[] = [assistantMessage, seeReceipt, legacyHydration, readReceipt];

    const relocated = await hydrateVisionHistory(legacy, vfs);

    expect(relocated.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
    expect(imageMessageCount(relocated)).toBe(1);
    expect(toModelMessages(relocated).map((m) => m.role)).toEqual([
      'assistant', 'tool', 'user',
    ]);
  });
});