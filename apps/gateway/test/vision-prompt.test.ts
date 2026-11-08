import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { VirtualFileSystem } from '../src/system/sandbox';
import { CoreToolsManager } from '../src/tools/core/core_tools';
import { hydrateVisionHistory } from '../src/system/vision-hydrate';
import type { LiteLLMMessage } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures: a real VFS with a real PNG, and the receipts see_image produces.
// ---------------------------------------------------------------------------

const runId = 'run-vision-prompt';
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
  podletDir = await mkdtemp(join(tmpdir(), 'podlet-vision-prompt-'));
  const artifacts = join(podletDir, 'runs', runId, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'chart.png'), makePng(64, 64));

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

/** Run the real see_image tool so the tool content is a genuine receipt. */
async function seeImage(id: string, paths: string[]): Promise<LiteLLMMessage> {
  const message = await tools.execute('see_image', id, { paths });
  return message as unknown as LiteLLMMessage;
}

function firstTextPart(message: LiteLLMMessage): string {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const first = content[0] as { type?: string; text?: string };
  return first?.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

// ---------------------------------------------------------------------------
// 1. The context tree prompt: images already in the conversation are visible.
// ---------------------------------------------------------------------------

describe('getContextTree prompt', () => {
  test('rule 7 covers only images not already in the conversation', async () => {
    const tree = await vfs.getContextTree();
    expect(tree).toContain('NOT already in the conversation');
    expect(tree).not.toContain('image (.png, .jpg, .jpeg, .webp, .gif), use see_image.');  });

  test('rule 8 says attached images are already visible', async () => {
    const tree = await vfs.getContextTree();
    expect(tree).toContain(
      '8. Images the user attached to the conversation are already visible to you.',
    );
    expect(tree).toContain('Never call see_image on a file you have already been shown.');
  });

  test('the anti-OCR rule is present', async () => {
    const tree = await vfs.getContextTree();
    expect(tree).toContain('NEVER write OCR, extraction or image-processing code');
  });
});

// ---------------------------------------------------------------------------
// 2. see_image itself carries the consequence.
// ---------------------------------------------------------------------------

describe('see_image tool result', () => {
  test('a successful call returns a note telling the model to read directly', async () => {
    const receipt = await tools.execute('see_image', 'call_note', {
      paths: ['artifacts/chart.png'],
    });

    const parsed = JSON.parse(String(receipt.content)) as {
      ok: boolean;
      images: Array<{ vpath: string }>;
      errors: string[];
      note?: string;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.images[0]!.vpath).toBe('artifacts/chart.png');
    expect(typeof parsed.note).toBe('string');
    expect(parsed.note).toContain('Read them directly');
  });
});

// ---------------------------------------------------------------------------
// 3. The hydration message keeps its idempotency prefix and gains the guidance.
// ---------------------------------------------------------------------------

describe('hydrateVisionHistory guidance line', () => {
  test('a hydrated image message keeps the prefix and contains the guidance', async () => {
    const history: LiteLLMMessage[] = [
      assistant([['call_see', 'see_image', { paths: ['artifacts/chart.png'] }]]),
      await seeImage('call_see', ['artifacts/chart.png']),
    ];

    const hydrated = await hydrateVisionHistory(history, vfs);
    const userMessage = hydrated.find((m) => m.role === 'user');
    expect(userMessage).toBeDefined();

    const text = firstTextPart(userMessage!);
    expect(text.startsWith('Images from see_image call call_see:')).toBe(true);
    expect(text).toContain(
      'Read these images directly from your context. Do not write OCR, extraction or image-processing code to read them.',
    );
  });

  test('a receipt whose file is gone gets no guidance line', async () => {
    const receipt = await seeImage('call_missing', ['artifacts/chart.png']);
    // Remove the file so every image in the receipt fails to hydrate.
    await rm(join(podletDir, 'runs', runId, 'artifacts', 'chart.png'), { force: true });

    const hydrated = await hydrateVisionHistory(
      [assistant([['call_missing', 'see_image', { paths: ['artifacts/chart.png'] }]]), receipt],
      vfs,
    );

    const userMessage = hydrated.find((m) => m.role === 'user');
    expect(userMessage).toBeDefined();

    const text = firstTextPart(userMessage!);
    expect(text.startsWith('Images from see_image call call_missing:')).toBe(true);
    expect(text).not.toContain('Read these images directly from your context.');
  });
});