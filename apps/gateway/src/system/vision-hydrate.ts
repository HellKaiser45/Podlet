import type { ChatCompletionContentPart, SeeImageReceipt } from '@podlet/types';
import type { LiteLLMMessage } from '../types';
import type { VirtualFileSystem } from './sandbox';
import { prepareImage } from './vision';
import { visionCache } from './vision-cache';

// ---------------------------------------------------------------------------
// Local shapes
// ---------------------------------------------------------------------------

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
  // A message with an empty images array must be left untouched so that
  // re-running hydration is idempotent.
  if (obj.images.length === 0) return null;

  return {
    index,
    toolCallId: String((message as { tool_call_id?: unknown }).tool_call_id ?? ''),
    receipts: obj.images as SeeImageReceipt[],
  };
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
 * Every image in history is hydrated — there is no live-image or token budget,
 * so no image is ever dropped. The prepared-image cache is what keeps repeated
 * turns cheap: when the source file is unchanged since it was viewed, hydration
 * never re-reads or re-decodes it.
 *
 * Pure with respect to `history`: the input array and every object within it
 * are left untouched; a new array is returned.
 */
export async function hydrateVisionHistory(
  history: LiteLLMMessage[],
  vfs: VirtualFileSystem,
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

  // 2. Prepare every image in every record, and build one user message per
  //    hydrated tool message.
  const hydrated = new Map<number, { text: string; parts: ChatCompletionContentPart[] }>();

  for (let r = records.length - 1; r >= 0; r--) {
    const record = records[r];

    const lines: string[] = [];
    const parts: ChatCompletionContentPart[] = [];

    for (const receipt of record.receipts) {
      const vpath = receipt.vpath;

      // Stat instead of read: the common case (unchanged file, warm cache)
      // needs no bytes at all.
      let realPath: string;
      let statSize: number;
      let statMtime: number;
      try {
        realPath = vfs.resolveVirtual(vpath);
        const stat = await Bun.file(realPath).stat();
        statSize = stat.size;
        statMtime = stat.mtime.getTime();
      } catch {
        lines.push(`${vpath}: file no longer exists — call see_image again`);
        continue;
      }

      const unchanged =
        statSize === receipt.source.bytes && statMtime === receipt.source.mtime_ms;

      const cached = visionCache.get(receipt.sha);

      if (unchanged && cached) {
        // No file read, no prepareImage: the prepared bytes are already warm.
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${cached.mime};base64,${cached.b64}` },
        });
        lines.push(`${vpath} (${cached.width}x${cached.height}, ~${receipt.tokens_est} tokens)`);
        continue;
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await Bun.file(realPath).arrayBuffer());
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
      visionCache.set(image.sha, {
        b64,
        mime: image.mime,
        width: image.width,
        height: image.height,
        bytes: image.bytes.byteLength,
      });

      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${b64}` },
      });

      lines.push(`${vpath} (${image.width}x${image.height}, ~${receipt.tokens_est} tokens)`);
      if (image.sha !== receipt.sha) {
        // The file changed on disk after it was viewed. Ship the fresh bytes
        // (never a stale sha) but tell the model.
        lines.push(`${vpath}: changed on disk since it was viewed`);
      }
    }

    const header = `Images from see_image call ${record.toolCallId}:`
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

    // Every record is hydrated above, so the entry always exists here.
    const hydratedEntry = hydrated.get(i)!;

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
  }

  return result;
}