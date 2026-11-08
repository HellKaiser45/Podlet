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

/**
 * True when `message` is a hydration message for ANY tool call. Used to
 * recognise one that an older pass left inside a run of tool messages, so it
 * can be re-placed after the run instead of left in place.
 */
function isAnyHydrationMessage(message: LiteLLMMessage): boolean {
  if (message.role !== 'user') return false;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return false;
  const first = content[0] as { type?: unknown; text?: unknown };
  return (
    first?.type === 'text' &&
    typeof first.text === 'string' &&
    first.text.startsWith('Images from see_image call ')
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
 * The message is a text part first — `Images from see_image call <toolCallId>:`
 * followed by one line per image — then one image part per hydrated image. When
 * at least one image part was produced, a final guidance line tells the model to
 * read those images directly instead of writing OCR or extraction code.
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

      const prepared = await prepareImage(bytes, receipt.source.mime);

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
    const base = lines.length === 1 ? `${header} ${lines[0]}` : `${header}\n${lines.join('\n')}`;
    const text = parts.length > 0
      ? `${base}\nRead these images directly from your context. Do not write OCR, extraction or image-processing code to read them.`
      : base;
    hydrated.set(record.index, { text, parts });
  }

  // 4. Assemble the output array.
  //
  // A hydration message is a `user` message, so it may never sit between two
  // tool results: the AI SDK prompt converter rejects the whole request then,
  // with "Tool result is missing for tool call <id>", on every protocol. Each
  // run of consecutive `tool` messages therefore stays contiguous, and every
  // hydration message belonging to a run is appended AFTER the run — one per
  // `see_image` result, in their original relative order.
  const result: LiteLLMMessage[] = [];
  let i = 0;
  while (i < history.length) {
    if (history[i]!.role !== 'tool') {
      result.push(history[i]!);
      i++;
      continue;
    }

    // A run is the tool messages plus any hydration message interleaved with
    // them — where older passes (and the pre-fix code) left them.
    const toolIndices: number[] = [];
    const strayHydration: LiteLLMMessage[] = [];
    let end = i;
    for (; end < history.length; end++) {
      const current = history[end]!;
      if (current.role === 'tool') toolIndices.push(end);
      else if (isAnyHydrationMessage(current)) strayHydration.push(current);
      else break;
    }

    // Every tool result first, so the run stays contiguous.
    for (const index of toolIndices) result.push(history[index]!);

    // Then the pixels, in receipt order.
    for (const index of toolIndices) {
      const record = recordByIndex.get(index);
      if (!record) continue;

      const match = strayHydration.findIndex((m) => isHydrationMessage(m, record.toolCallId));
      if (match !== -1) {
        // Already hydrated by a previous pass — reuse it verbatim so a second
        // call is idempotent instead of duplicating the image message.
        result.push(strayHydration[match]!);
        strayHydration.splice(match, 1);
        continue;
      }

      // Every record is hydrated above, so the entry always exists here.
      const hydratedEntry = hydrated.get(index)!;
      result.push(makeUserMessage(hydratedEntry.text, hydratedEntry.parts));
    }

    i = end;
  }

  return result;
}