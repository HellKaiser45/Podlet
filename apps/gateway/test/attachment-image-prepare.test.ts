import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { ChatCompletionContentPart } from '@podlet/types';
import { VirtualFileSystem } from '../src/system/sandbox';
import { prepareImage } from '../src/system/vision';

const runId = 'run-sandbox-images';
let podletDir: string;
let vfs: VirtualFileSystem;

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
  podletDir = await mkdtemp(join(tmpdir(), 'podlet-sandbox-images-'));
  const artifacts = join(podletDir, 'runs', runId, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'small.png'), makePng(64, 64));
  await writeFile(join(artifacts, 'huge.png'), makePng(3000, 3000));
  await writeFile(join(artifacts, 'broken.png'), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

  vfs = new VirtualFileSystem(podletDir, runId);
});

afterAll(async () => {
  await rm(podletDir, { recursive: true, force: true });
});

async function contentBlock(
  vpaths: string[],
): Promise<ChatCompletionContentPart[]> {
  const block = await vfs.generateContentBlock(vpaths, {
    role: 'user',
    content: 'what is in this image?',
  } as never);
  return block.content as ChatCompletionContentPart[];
}

function imageUrlParts(parts: ChatCompletionContentPart[]) {
  return parts.filter(
    (part) => part.type === 'image_url',
  ) as Array<{ type: 'image_url'; image_url: { url: string } }>;
}

function decodeDataUri(url: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) throw new Error(`not a base64 data URI: ${url.slice(0, 40)}`);
  return { mime: match[1]!, bytes: new Uint8Array(Buffer.from(match[2]!, 'base64')) };
}

describe('generateContentBlock image preparation', () => {
  test('a PNG attachment becomes a prepared image_url data URI', async () => {
    const parts = await contentBlock(['artifacts/small.png']);

    const images = imageUrlParts(parts);
    expect(images).toHaveLength(1);

    const { mime, bytes } = decodeDataUri(images[0]!.image_url.url);
    const prepared = await prepareImage(bytes, mime, { maxEdge: 1568 });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(images[0]!.image_url.url.startsWith(`data:${prepared.mime};base64,`)).toBe(true);
    expect(prepared.width).toBe(64);
    expect(prepared.height).toBe(64);

    // The prompt text still rides along after the attachment.
    expect(parts.some((part) => part.type === 'text')).toBe(true);
  });

  test('a 3000x3000 PNG is downscaled to a 1568 long edge', async () => {
    const parts = await contentBlock(['artifacts/huge.png']);

    const images = imageUrlParts(parts);
    expect(images).toHaveLength(1);

    const url = images[0]!.image_url.url;
    expect(url.startsWith('data:image/png;base64,')).toBe(true);

    const { mime, bytes } = decodeDataUri(url);
    const prepared = await prepareImage(bytes, mime, { maxEdge: 1568 });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.mime).toBe('image/png');
    expect(Math.max(prepared.width, prepared.height)).toBe(1568);
    expect(prepared.width).toBe(1568);
    expect(prepared.height).toBe(1568);
  });

  test('an undecodable attachment becomes a text part instead of raw bytes', async () => {
    const parts = await contentBlock(['artifacts/broken.png']);

    expect(imageUrlParts(parts)).toHaveLength(0);

    const text = parts
      .filter((part) => part.type === 'text')
      .map((part) => String((part as { text?: string }).text ?? ''))
      .join('\n');
    expect(text).toContain('artifacts/broken.png');
    expect(text.toLowerCase()).toContain('could not be prepared');
  });
});