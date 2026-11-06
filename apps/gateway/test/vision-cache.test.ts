import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { SeeImageReceipt, VisionSettings } from '@podlet/types';
import { VirtualFileSystem } from '../src/system/sandbox';
import { prepareImage } from '../src/system/vision';
import { MAX_ENTRIES, visionCache } from '../src/system/vision-cache';
import { hydrateVisionHistory } from '../src/system/vision-hydrate';
import type { LiteLLMMessage } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

let podletDir: string;
let vfs: VirtualFileSystem;
const runId = 'vision-run';

const settings: VisionSettings = {
  enabled: true,
  max_live_images: 4,
  max_live_image_tokens: 12_000,
  max_edge: 1568,
  max_images_per_call: 4,
};

function makePng(width: number, height: number, color = '#204a87'): Uint8Array {
  const canvas = createCanvas(width, height);
  try {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    return new Uint8Array(canvas.toBuffer('image/png'));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function imageEntry(bytes = 1) {
  return { b64: '', mime: 'image/png', width: 1, height: 1, bytes };
}

async function writeArtifact(rel: string, bytes: Uint8Array): Promise<void> {
  await writeFile(vfs.resolveVirtual(rel), Buffer.from(bytes));
}

/** Build a receipt the same way SeeImageTool would, from a file on disk. */
async function makeReceipt(vpath: string, tokensEst?: number): Promise<SeeImageReceipt> {
  const real = vfs.resolveVirtual(vpath);
  const bytes = new Uint8Array(await Bun.file(real).arrayBuffer());
  const stat = await Bun.file(real).stat();
  const prepared = await prepareImage(bytes, 'image/png', { maxEdge: 1568 });
  if (!prepared.ok) throw new Error(`fixture prepareImage failed: ${prepared.reason}`);

  return {
    vpath,
    id: vpath,
    sha: prepared.sha,
    source: {
      mime: 'image/png',
      width: prepared.sourceWidth,
      height: prepared.sourceHeight,
      bytes: stat.size,
      mtime_ms: stat.mtime.getTime(),
    },
    rendered: {
      mime: prepared.mime,
      width: prepared.width,
      height: prepared.height,
      bytes: prepared.bytes.byteLength,
      max_edge: 1568,
      format: 'png',
      crop: null,
    },
    tokens_est: tokensEst ?? prepared.tokensEst,
    dropped_from_context: false,
  };
}

function visionToolMessage(toolCallId: string, receipts: SeeImageReceipt[]): LiteLLMMessage {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify({ ok: true, images: receipts, errors: [] }),
  } as unknown as LiteLLMMessage;
}

function toolMessageById(history: LiteLLMMessage[], toolCallId: string): LiteLLMMessage | undefined {
  return history.find(
    (m) => (m as { tool_call_id?: unknown }).tool_call_id === toolCallId,
  );
}

beforeAll(async () => {
  podletDir = await mkdtemp(join(tmpdir(), 'podlet-vision-'));
  vfs = new VirtualFileSystem(podletDir, runId, { skills: [] });
  await vfs.ensureRunRoot();
  // artifacts/ holds the writable fixtures; make sure it is writable.
  await chmod(join(podletDir, 'runs', runId, 'artifacts'), 0o755).catch(() => {});
});

afterAll(async () => {
  await rm(podletDir, { recursive: true, force: true });
});

beforeEach(() => {
  visionCache.clear();
});

// ---------------------------------------------------------------------------
// VisionCache
// ---------------------------------------------------------------------------

describe('visionCache', () => {
  test('set/get round-trip and miss counting', () => {
    const image = { b64: 'AAA', mime: 'image/png', width: 10, height: 20, bytes: 3 };
    visionCache.set('abc', image);

    expect(visionCache.get('abc')).toEqual(image);
    expect(visionCache.stats().hits).toBe(1);

    expect(visionCache.get('missing')).toBeUndefined();
    expect(visionCache.stats().misses).toBe(1);
  });

  test('clear resets entries, bytes and stats', () => {
    visionCache.set('abc', imageEntry(5));
    visionCache.get('abc');
    visionCache.clear();

    expect(visionCache.stats()).toEqual({ hits: 0, misses: 0, entries: 0, bytes: 0 });
    expect(visionCache.has('abc')).toBe(false);
  });

  test('set beyond MAX_ENTRIES evicts the oldest entry', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) visionCache.set(`k${i}`, imageEntry());

    expect(visionCache.stats().entries).toBe(MAX_ENTRIES);

    visionCache.set('extra', imageEntry());
    expect(visionCache.stats().entries).toBe(MAX_ENTRIES);
    expect(visionCache.has('k0')).toBe(false);
    expect(visionCache.has('extra')).toBe(true);
    expect(visionCache.has(`k${MAX_ENTRIES - 1}`)).toBe(true);
  });

  test('re-get marks an entry recently used so it is not evicted', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) visionCache.set(`k${i}`, imageEntry());

    // Touch the oldest entry, then overflow by one.
    visionCache.get('k0');
    visionCache.set('extra', imageEntry());

    expect(visionCache.has('k0')).toBe(true);
    expect(visionCache.has('k1')).toBe(false);
    expect(visionCache.has('extra')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hydrateVisionHistory
// ---------------------------------------------------------------------------

describe('hydrateVisionHistory', () => {
  test('second hydration is a cache hit and performs no re-prepare', async () => {
    await writeArtifact('artifacts/cache.png', makePng(200, 150));
    const receipt = await makeReceipt('artifacts/cache.png');
    const history = [visionToolMessage('call-1', [receipt])];

    // First call: cache miss -> prepare -> set.
    const first = await hydrateVisionHistory(history, vfs, settings);
    const afterFirst = visionCache.stats();
    expect(afterFirst.misses).toBe(1);
    expect(afterFirst.hits).toBe(0);
    expect(first.some((m) => m.role === 'user')).toBe(true);

    // Second call: unchanged file -> cache hit, no get-miss, no prepare.
    const second = await hydrateVisionHistory(history, vfs, settings);
    const afterSecond = visionCache.stats();
    expect(afterSecond.hits).toBe(afterFirst.hits + 1);
    expect(afterSecond.misses).toBe(afterFirst.misses);
    expect(second.some((m) => m.role === 'user')).toBe(true);
  });

  test('token budget stubs older images and keeps the newest', async () => {
    await writeArtifact('artifacts/t-newest.png', makePng(40, 40));
    await writeArtifact('artifacts/t-mid.png', makePng(50, 50));
    const newest = await makeReceipt('artifacts/t-newest.png', 5000);
    const mid = await makeReceipt('artifacts/t-mid.png', 5000);
    // Oldest references a file that need not exist: it is stubbed before any
    // stat because the token budget is already exhausted.
    const oldest: SeeImageReceipt = {
      ...newest,
      vpath: 'artifacts/t-oldest-missing.png',
      id: 'artifacts/t-oldest-missing.png',
      tokens_est: 5000,
    };

    const history = [
      visionToolMessage('old-call', [oldest]),
      visionToolMessage('mid-call', [mid]),
      visionToolMessage('new-call', [newest]),
    ];

    const out = await hydrateVisionHistory(history, vfs, {
      ...settings,
      max_live_image_tokens: 8000,
    });

    // Newest survives and is followed by a user message carrying the image.
    const newIdx = out.findIndex(
      (m) => (m as { tool_call_id?: unknown }).tool_call_id === 'new-call',
    );
    expect(newIdx).toBeGreaterThanOrEqual(0);
    const afterNew = out[newIdx + 1] as { role?: string; content?: unknown };
    expect(afterNew.role).toBe('user');
    const parts = afterNew.content as Array<{ type?: string }>;
    expect(parts.some((p) => p.type === 'image_url')).toBe(true);

    // Older messages become stubs.
    for (const id of ['mid-call', 'old-call']) {
      const msg = toolMessageById(out, id) as { content?: string };
      const parsed = JSON.parse(msg.content ?? '{}');
      expect(parsed.images).toEqual([]);
      expect(parsed.stub).toContain('image no longer in context');
    }
  });

  test('a file changed on disk is re-prepared and flagged', async () => {
    await writeArtifact('artifacts/change.png', makePng(60, 60));
    const before = await makeReceipt('artifacts/change.png');
    const history = [visionToolMessage('change-call', [before])];

    await hydrateVisionHistory(history, vfs, settings);

    // Rewrite the source with different bytes and a newer mtime.
    const real = vfs.resolveVirtual('artifacts/change.png');
    await writeFile(real, Buffer.from(makePng(30, 30, '#aa2222')));
    const future = new Date(Date.now() + 10_000);
    await utimes(real, future, future);

    const out = await hydrateVisionHistory(history, vfs, settings);
    const userMsg = out.find((m) => m.role === 'user') as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = userMsg.content?.[0]?.text ?? '';
    expect(text).toContain('changed on disk since it was viewed');
    expect(userMsg.content?.some((p) => p.type === 'image_url')).toBe(true);
  });
});