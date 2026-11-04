import type { ChatCompletionContentPart, VisionSettings } from '@podlet/types';
import type { LiteLLMMessage } from '../types';
import type { VirtualFileSystem } from './sandbox';
import { prepareImage } from './vision';

// ---------------------------------------------------------------------------
// Receipt shape
// ---------------------------------------------------------------------------
//
// Mirrors the `SeeImageReceipt` produced by `SeeImageTool`. It is duplicated
// here (rather than imported from core_tools) so this module stays free of any
// dependency on the tools layer — importantly it must not create an import
// cycle with sandbox.ts.

interface ReceiptCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: 'px' | 'fraction';
}

interface SeeImageReceipt {
  vpath: string;
  id: string;
  sha: string;
  source: { mime: string; width: number; height: number; bytes: number };
  rendered: {
    mime: string;
    width: number;
    height: number;
    bytes: number;
    max_edge: number;
    format: 'png' | 'jpeg';
    crop: ReceiptCrop | null;
  };
  tokens_est: number;
  dropped_from_context: boolean;
}

interface VisionToolMessage {
  index: number;
  toolCallId: string;
  receipts: SeeImageReceipt[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A vision tool message is a `role:'tool'` message whose string content is the
 * JSON receipt `{ ok:true, images:[...], errors:[...] }`. Every other tool
 * (`read_file`, `execute_shell`, …) either has non-object content or an object
 * without an `images` array and is ignored.
 */
function parseVisionToolMessage(
  index: number,
  message: LiteLLMMessage,
): VisionToolMessage | null {
  if (message.role !== 'tool') return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.ok !== true) return null;
  if (!Array.isArray(obj.images)) return null;
  // An already-stubbed message (images: []) must be left untouched so that
  // re-running hydration is idempotent.
  if (obj.images.length === 0) return null;

  return {
    index,
    toolCallId: String((message as { tool_call_id?: unknown }).tool_call_id ?? ''),
    receipts: obj.images as SeeImageReceipt[],
  };
}

function stubContent(vpaths: string[], reason: 'context' | 'size'): string {
  const suffix = reason === 'size' ? ' (dropped: request size cap)' : '';
  const text = `image no longer in context — call see_image again to view ${vpaths.join(', ')}${suffix}`;
  return JSON.stringify({ ok: true, images: [], errors: [], stub: text });
}

function makeUserMessage(text: string, parts: ChatCompletionContentPart[]): LiteLLMMessage {
  // The text part MUST come first and MUST always be present: an image-only
  // turn breaks Gemini/OpenRouter, and a text block before a tool_result is
  // rejected by Anthropic (400).
  const content: ChatCompletionContentPart[] = [{ type: 'text', text }, ...parts];
  return { role: 'user', content } as LiteLLMMessage;
}

/**
 * True when `message` is a `user` hydration message already produced for
 * `toolCallId` — used to stay idempotent when hydration runs over an
 * already-hydrated history.
 */
function isHydrationMessage(message: LiteLLMMessage, toolCallId: string): boolean {
  if (message.role !== 'user') return false;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return false;
  const first = content[0] as { type?: unknown; text?: unknown };
  return (
    first?.type === 'text' &&
    typeof first.text === 'string' &&
    first.text.startsWith(`Images from see_image call ${toolCallId}:`)
  );
}

// ---------------------------------------------------------------------------
// hydrateVisionHistory
// ---------------------------------------------------------------------------

/**
 * Turn `see_image` tool receipts into a follow-up `user` message carrying real
 * image parts. `CoreToolsManager.execute()` returns `role:'tool'` messages
 * whose content is a string, and OpenAI Chat Completions tool messages have no
 * image slot — so pixels must travel as a separate `user` message injected
 * here, at request-build time.
 *
 * Pure with respect to `history`: the input array and every object within it
 * are left untouched; a new array is returned.
 */
export async function hydrateVisionHistory(
  history: LiteLLMMessage[],
  vfs: VirtualFileSystem,
  settings: VisionSettings,
): Promise<LiteLLMMessage[]> {
  // Shallow copy: entries are only replaced/extended, never mutated.
  const output: LiteLLMMessage[] = history.slice();

  // 1. Collect vision tool messages (chronological order).
  const records: VisionToolMessage[] = [];
  const recordByIndex = new Map<number, VisionToolMessage>();
  for (let i = 0; i < history.length; i++) {
    const record = parseVisionToolMessage(i, history[i]);
    if (record) {
      records.push(record);
      recordByIndex.set(i, record);
    }
  }
  if (records.length === 0) return output;

  // 2. Newest-first image budget. Keyed by `<msgIndex>:<imgIndex>`.
  const budgeted = new Set<string>();
  let imagesRemaining = Math.max(0, Math.floor(settings.max_live_images));
  for (let r = records.length - 1; r >= 0 && imagesRemaining > 0; r--) {
    const record = records[r];
    for (let k = 0; k < record.receipts.length && imagesRemaining > 0; k++) {
      budgeted.add(`${record.index}:${k}`);
      imagesRemaining--;
    }
  }

  // 3. Prepare images newest-first, enforcing the request byte cap, and build
  //    one user message per hydrated tool message.
  const hydrated = new Map<number, { text: string; parts: ChatCompletionContentPart[] }>();
  const stubReason = new Map<number, 'context' | 'size'>();

  let bytesUsed = 0;
  let sizeCapped = false;

  for (let r = records.length - 1; r >= 0; r--) {
    const record = records[r];

    const budgetedReceipts = record.receipts.filter((_, k) =>
      budgeted.has(`${record.index}:${k}`),
    );

    if (budgetedReceipts.length === 0) {
      stubReason.set(record.index, 'context');
      continue;
    }
    if (sizeCapped) {
      stubReason.set(record.index, 'size');
      continue;
    }

    const lines: string[] = [];
    const parts: ChatCompletionContentPart[] = [];
    let recordBytes = 0;

    for (const receipt of budgetedReceipts) {
      const vpath = receipt.vpath;
      let bytes: Uint8Array;
      try {
        const realPath = vfs.virtualToReal(vpath);
        const file = Bun.file(realPath);
        if (!(await file.exists())) {
          lines.push(`${vpath}: file no longer exists — call see_image again`);
          continue;
        }
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch (err) {
        lines.push(`${vpath}: could not be re-read (${vfs.sanitizeErrorMessage(err)})`);
        continue;
      }

      const prepared = await prepareImage(bytes, receipt.source.mime, {
        maxEdge: receipt.rendered.max_edge,
        crop: receipt.rendered.crop ?? undefined,
      });

      if ('ok' in prepared && prepared.ok === false) {
        lines.push(`${vpath}: could not be re-read (${prepared.reason})`);
        continue;
      }

      const image = prepared;
      const b64 = Buffer.from(image.bytes).toString('base64');
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${b64}` },
      });
      recordBytes += b64.length;

      lines.push(`${vpath} (${image.width}x${image.height}, ~${receipt.tokens_est} tokens)`);
      if (image.sha !== receipt.sha) {
        // The file changed on disk after it was viewed. Ship the fresh bytes
        // (never a stale sha) but tell the model.
        lines.push(`${vpath}: changed on disk since it was viewed`);
      }
    }

    // Byte cap: once a message would push the cumulative sent-image bytes over
    // the limit, stub it and every older message. The newest hydrated message
    // is always allowed through even if it alone exceeds the cap.
    if (bytesUsed > 0 && bytesUsed + recordBytes > settings.max_bytes_per_request) {
      stubReason.set(record.index, 'size');
      sizeCapped = true;
      continue;
    }
    bytesUsed += recordBytes;

    const header = `Images from see_image call ${record.toolCallId}:`;
    const text = lines.length === 1 ? `${header} ${lines[0]}` : `${header}\n${lines.join('\n')}`;
    hydrated.set(record.index, { text, parts });
  }

  // 4. Assemble the output array.
  const result: LiteLLMMessage[] = [];
  const skip = new Set<number>();
  for (let i = 0; i < history.length; i++) {
    if (skip.has(i)) continue;

    const message = history[i];
    const record = recordByIndex.get(i);
    if (!record) {
      result.push(message);
      continue;
    }

    const hydratedEntry = hydrated.get(i);
    if (hydratedEntry) {
      // Tool message is unchanged; the pixels travel in the user message that
      // follows it immediately.
      result.push(message);
      const next = history[i + 1];
      if (next && isHydrationMessage(next, record.toolCallId)) {
        // Already hydrated by a previous pass — reuse it verbatim so a second
        // call is idempotent instead of duplicating the image message.
        result.push(next);
        skip.add(i + 1);
      } else {
        result.push(makeUserMessage(hydratedEntry.text, hydratedEntry.parts));
      }
      continue;
    }

    const reason = stubReason.get(i) ?? 'context';
    const vpaths = record.receipts.map((rc) => rc.vpath);
    result.push({ ...(message as object), content: stubContent(vpaths, reason) } as LiteLLMMessage);
  }

  return result;
}