import type {
  AssistantContent,
  ImagePart,
  JSONSchema7,
  ModelMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  ToolSet,
  UserContent,
} from 'ai';
import { jsonSchema, tool } from 'ai';
import type { ChatCompletionTool } from '@podlet/types';
import type { LiteLLMMessage } from '../types';

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
 *  - image_url parts become `image` parts carrying the URL/data-URI string.
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

/** Build a `ToolSet` of tools WITHOUT `execute`: our loop runs tools itself. */
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
  return '';
}

function contentToUserContent(content: unknown): UserContent {
  if (typeof content === 'string') return content;
  return contentToTextParts(content);
}

function contentToTextParts(content: unknown): Array<TextPart | ImagePart> {
  if (!Array.isArray(content)) return [];
  const parts: Array<TextPart | ImagePart> = [];
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
      parts.push({ type: 'image', image: part.image_url.url });
    }
  }
  return parts;
}