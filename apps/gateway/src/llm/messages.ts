import type {
  AssistantContent,
  AssistantModelMessage,
  FilePart,
  JSONSchema7,
  ModelMessage,
  SystemModelMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  ToolSet,
  UserContent,
  UserModelMessage,
} from 'ai';
import { jsonSchema, tool } from 'ai';
import type { ChatCompletionTool } from '@podlet/types';
import type { LiteLLMMessage, ProviderQuirks } from '../types';

/**
 * Anthropic allows at most four prompt-cache breakpoints per request
 * (@ai-sdk/anthropic dist/index.js:1559 `const MAX_CACHE_BREAKPOINTS = 4`, and
 * :1585 pushes an `unsupported` warning past it). We place two: one on the
 * stable system prompt and one on the last message.
 */
export const MAX_CACHE_BREAKPOINTS = 4;

/** The providerOptions value Anthropic reads as a breakpoint on a message part. */
const CACHE_CONTROL = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

/**
 * The two system prompts, kept apart so only the stable half is cached.
 *
 * `stable` is skills + agent prompt: identical on every turn of a conversation.
 * `volatile` is the virtual file-system context tree, which changes each turn —
 * putting it inside the cached span would invalidate the cache every time.
 */
type SystemPromptParts = { stable: string; volatile: string };

/**
 * Build the entries sent as `messages` for an anthropic request, with cache
 * breakpoints. Returns the history untouched for every other protocol.
 *
 * Why two system *messages* rather than one message with an array of text parts:
 * `SystemModelMessage.content` is typed `string` in the installed SDK
 * (@ai-sdk/provider-utils dist/index.d.ts:1784-1794: `role: 'system'; content:
 * string; providerOptions?: ProviderOptions`), so a part array cannot be
 * expressed. Two consecutive system messages are equivalent: the Anthropic
 * converter groups them into one block and emits one text part per message,
 * each carrying its own `cache_control`
 * (@ai-sdk/anthropic dist/index.js:2732-2755: for each block message it pushes
 * `{ type: 'text', text, cache_control: validator.getCacheControl(providerOptions,
 * { type: 'system message', canCache: true }) }`).
 *
 * A system role inside `messages` requires `allowSystemInMessages` on the
 * streamText call (@ai-sdk/ai dist/index.js:2246 throws `InvalidPromptError`
 * otherwise).
 */
export function withCacheControl(
  history: ModelMessage[],
  systemParts: SystemPromptParts,
  quirks: ProviderQuirks,
): ModelMessage[] {
  if (quirks.no_cache_control) return history;

  const systemMessages: SystemModelMessage[] = [
    // Breakpoint 1: the stable span. Everything before this stays cached.
    { role: 'system', content: systemParts.stable, providerOptions: CACHE_CONTROL },
    // No breakpoint: this text is regenerated every turn.
    { role: 'system', content: systemParts.volatile },
  ];

  const messages = [...systemMessages, ...history];

  // Breakpoint 2: the last message, the checkpoint the next turn resumes from.
  const withLast = addBreakpointToLastMessage(messages);

  assertBreakpointBudget(withLast);
  return withLast;
}

/**
 * Attach the cache breakpoint to the final message. Message-level providerOptions
 * is read for the last part of a user message
 * (@ai-sdk/anthropic dist/index.js:2803-2813), so a string-content user turn is
 * rewritten to a single text part carrying the option; an array-content turn
 * gains it on its last part.
 */
function addBreakpointToLastMessage(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1]!;

  if (last.role === 'user') {
    const content = (last as UserModelMessage).content;
    const parts: UserContent =
      typeof content === 'string'
        ? content.length > 0
          ? [{ type: 'text', text: content, providerOptions: CACHE_CONTROL }]
          : []
        : content.map((part, index) =>
            index === content.length - 1 ? { ...part, providerOptions: CACHE_CONTROL } : part,
          );
    return [...messages.slice(0, -1), { role: 'user', content: parts }];  }
  if (last.role === 'assistant') {
    const content = (last as AssistantModelMessage).content;
    if (typeof content === 'string') {
      if (content.length === 0) return messages;
      return [
        ...messages.slice(0, -1),
        {
          role: 'assistant',
          content: [{ type: 'text', text: content, providerOptions: CACHE_CONTROL }],
        },
      ];
    }
    if (content.length === 0) return messages;
    return [
      ...messages.slice(0, -1),
      {
        role: 'assistant',
        content: content.map((part, index) =>
          index === content.length - 1 ? { ...part, providerOptions: CACHE_CONTROL } : part,
        ),
      },
    ];
  }

  // A tool message carries results only; the converter reads no cache option
  // there, so the previous message remains the effective checkpoint.
  return messages;
}

/** Count every breakpoint in the payload and refuse to exceed Anthropic's limit. */
export function countCacheBreakpoints(messages: ModelMessage[]): number {
  let count = 0;
  for (const message of messages) {
    const providerOptions = (message as { providerOptions?: Record<string, unknown> }).providerOptions;
    if (hasCacheControl(providerOptions)) count++;
    const content = (message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (hasCacheControl((part as { providerOptions?: Record<string, unknown> }).providerOptions)) {
          count++;
        }
      }
    }
  }
  return count;
}

function hasCacheControl(providerOptions: Record<string, unknown> | undefined): boolean {
  const anthropic = providerOptions?.anthropic as
    | { cacheControl?: unknown; cache_control?: unknown }
    | undefined;
  return anthropic?.cacheControl != null || anthropic?.cache_control != null;
}

function assertBreakpointBudget(messages: ModelMessage[]): void {
  const count = countCacheBreakpoints(messages);
  if (count > MAX_CACHE_BREAKPOINTS) {
    throw new Error(
      `prompt caching: ${count} cache breakpoints placed, but Anthropic allows at most ${MAX_CACHE_BREAKPOINTS}`,
    );
  }
}

/**
 * Convert the stored, OpenAI-shaped history into AI SDK `ModelMessage`s.
 * The input is never mutated.
 *
 * Hard rules:
 *  - consecutive `tool` messages fold into ONE tool message with N result
 *    parts (AI SDK/Anthropic reject a run of single-result tool messages);
 *  - a tool result's `toolName` is not stored on the message, so it is resolved
 *    from the `tool_call_id` in the nearest preceding assistant `tool_calls`;
 *  - assistant `reasoning_content` / `thinking_blocks` are preserved as
 *    reasoning parts (the Anthropic thinking signature rides in providerOptions);
 *  - image_url parts become `file` parts with mediaType carrying the URL/data-URI
 *    string.
 */
export function toModelMessages(history: LiteLLMMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  type AssistantPart = Exclude<AssistantContent, string>[number];
  let i = 0;

  while (i < history.length) {
    const msg = history[i]!;

    if (msg.role === 'tool') {
      // Fold the whole run of consecutive tool messages into a single message.
      const results: ToolResultPart[] = [];
      while (i < history.length && history[i]!.role === 'tool') {
        const toolMsg = history[i]! as Extract<LiteLLMMessage, { role: 'tool' }>;
        const toolName = resolveToolName(history, i, toolMsg.tool_call_id);
        results.push({
          type: 'tool-result',
          toolCallId: toolMsg.tool_call_id,
          toolName,
          output: { type: 'text', value: contentToText(toolMsg.content) },
        });
        i++;
      }
      out.push({ role: 'tool', content: results });
      continue;
    }

    if (msg.role === 'system') {
      out.push({ role: 'system', content: contentToText(msg.content) });
      i++;
      continue;
    }

    if (msg.role === 'user') {
      out.push({ role: 'user', content: contentToUserContent(msg.content) });
      i++;
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: AssistantPart[] = [];

      // Reasoning comes first: Anthropic expects thinking blocks before text
      // and tool calls in the assistant turn.
      if (msg.reasoning_content) {
        parts.push({ type: 'reasoning', text: msg.reasoning_content });
      }
      if (Array.isArray(msg.thinking_blocks)) {
        for (const block of msg.thinking_blocks) {
          if (block.type === 'redacted_thinking') {
            // Redacted blocks carry no readable text, only the opaque payload
            // Anthropic requires back on the next turn.
            parts.push({
              type: 'reasoning',
              text: '',
              providerOptions: { anthropic: { redactedData: block.data } },
            });
            continue;
          }
          parts.push({
            type: 'reasoning',
            text: block.thinking,
            providerOptions: { anthropic: { signature: block.signature } },
          });
        }
      }

      if (typeof msg.content === 'string') {
        if (msg.content.length > 0) parts.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of contentToTextParts(msg.content)) {
          // Assistant content does not carry image parts; only text is valid here.
          if (part.type === 'text') parts.push(part);
        }
      }

      if (Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          if (call.type !== 'function') continue;
          const toolCall: ToolCallPart = {
            type: 'tool-call',
            toolCallId: call.id,
            toolName: call.function.name,
            input: parseToolInput(call.function.arguments),
          };
          parts.push(toolCall);
        }
      }

      out.push({ role: 'assistant', content: parts.length > 0 ? parts : '' });
      i++;
      continue;
    }

    // Unreachable for the stored union, but keep the loop making progress.
    i++;
  }

  return out;
}

/**
 * Build a `ToolSet` of tools WITHOUT `execute`: our loop runs tools itself.
 *
 * Every definition is marked `strict`, which `ai`'s `tool()` forwards onto the
 * language-model tool object (@ai-sdk/ai dist/index.js:2146 `...strict != null ?
 * { strict } : {}`). What each provider then does with it is the provider's
 * business, not ours: openai-compatible sends it on the function
 * (@ai-sdk/openai-compatible dist/index.js:324-328), anthropic sends it when the
 * model supports structured output and otherwise warns with feature 'strict'
 * (@ai-sdk/anthropic dist/index.js:1950-1961), and google switches function
 * calling to VALIDATED (@ai-sdk/google dist/index.js:1366,1375).
 */
export function toToolSet(tools: ChatCompletionTool[] | undefined): ToolSet {
  const set: Record<string, ReturnType<typeof tool>> = {};
  for (const entry of tools ?? []) {
    if (entry.type !== 'function' || !entry.function) continue;
    const fn = entry.function;
    const schema =
      fn.parameters && typeof fn.parameters === 'object'
        ? (fn.parameters as JSONSchema7)
        : ({ type: 'object', properties: {} } as JSONSchema7);
    set[fn.name] = tool({
      description: fn.description,
      inputSchema: jsonSchema(schema),
      strict: true,
    });
  }
  return set as ToolSet;
}

function resolveToolName(history: LiteLLMMessage[], index: number, toolCallId: string): string {
  for (let k = index - 1; k >= 0; k--) {
    const candidate = history[k]!;
    if (candidate.role !== 'assistant' || !Array.isArray(candidate.tool_calls)) continue;
    for (const call of candidate.tool_calls) {
      if (call.type !== 'function') continue;
      if (call.id === toolCallId) return call.function.name;
    }
  }
  throw new Error(
    `tool message references unknown tool_call_id '${toolCallId}': no preceding assistant tool_calls entry resolves its toolName`,
  );
}

function parseToolInput(args: unknown): unknown {
  if (typeof args !== 'string' || args.trim().length === 0) return {};
  try {
    return JSON.parse(args);
  } catch {
    // Preserve invalid arguments verbatim; downstream the chat loop replaces
    // them with the `_malformed_json` marker.
    return args;
  }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
          ? String((part as { text?: unknown }).text ?? '')
          : '',
      )
      .join('');
  }
  // Legitimately empty: a missing or null tool result has nothing to say.
  if (content === null || content === undefined) return '';
  // Anything else (object, number, boolean) is real data. Returning '' here would
  // hand the model an empty tool result while the UI still shows the payload
  // (the emit path JSON.stringify's it), so the model would retry the same call
  // forever with no visible failure. Serialize it instead and say so once, on
  // the line, so the mismatch cannot pass unnoticed. `JSON.stringify` yields
  // `undefined` for functions and symbols, hence the String() fallback.
  console.warn(
    '[llm] non-string content serialized as JSON for the model; the UI may show a different representation',
  );
  const serialized = JSON.stringify(content);
  return serialized === undefined ? String(content) : serialized;
}

function contentToUserContent(content: unknown): UserContent {
  if (typeof content === 'string') return content;
  return contentToTextParts(content);
}

function contentToTextParts(content: unknown): Array<TextPart | FilePart> {
  if (!Array.isArray(content)) return [];
  const parts: Array<TextPart | FilePart> = [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as {
      type?: string;
      text?: string;
      image_url?: { url?: string };
    };
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url' && part.image_url?.url) {
      // AI SDK accepts a URL string or a data URI directly.
      parts.push({
        type: 'file',
        mediaType: mediaTypeFromUrl(part.image_url.url),
        data: part.image_url.url,
      });
    }
  }
  return parts;
}

/**
 * The `mediaType` a FilePart must carry. A `data:` URI states it (`data:<mime>;base64,…`);
 * any other URL has no declared type, and the AI SDK only wants the top-level
 * segment in that case ("image"), never a guessed subtype.
 */
function mediaTypeFromUrl(url: string): string {
  if (url.startsWith('data:')) {
    const header = url.slice(5, url.indexOf(','));
    const semi = header.indexOf(';');
    const mime = (semi === -1 ? header : header.slice(0, semi)).trim();
    if (mime.length > 0) return mime;
  }
  return 'image';
}