import type {
  CallWarning,
  FinishReason,
  LanguageModel,
  ModelMessage,
  ToolSet,
} from 'ai';
import { streamText } from 'ai';
import type { LiteLLMDelta, LiteLLMStreamedChunk, ThinkingAnthropic } from '../types';

export type RunLlmStreamOptions = {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  providerOptions?: Record<string, Record<string, unknown>>;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
};

/**
 * A warning feature that names an explicitly requested capability. If the
 * provider reports one of these as `unsupported`, the request must fail rather
 * than continue with the capability silently dropped.
 */
const REQUESTED_CAPABILITIES = [
  'reason',
  'thinking',
  'cache',
  'responseformat',
  'response_format',
  'structured',
  'outputformat',
];

/** Accumulator for one provider reasoning block, keyed by the provider part id. */
type ReasoningBuffer = {
  text: string;
  signature?: string;
  redactedData?: string;
};

/**
 * Run one LLM call in-process and re-emit its parts in the legacy litellm chunk
 * shape that `AgentChatLoop` / `MessageAccumulator` already consume.
 */
export async function* runLlmStream(
  options: RunLlmStreamOptions,
): AsyncGenerator<LiteLLMStreamedChunk, void, unknown> {
  const result = streamText({
    model: options.model,
    system: options.system,
    messages: options.messages,
    tools: options.tools,
    providerOptions: options.providerOptions as any,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    // litellm performed no retries; adding them would change semantics.
    maxRetries: 0,
    abortSignal: options.abortSignal,
  });

  // NOT awaited here: some providers only settle `warnings` once the response
  // stream has been pulled, so awaiting first can deadlock.
  const warningsPromise = result.warnings;

  // Per-call, arrival-order counter for legacy tool_call indices.
  let toolCallCounter = 0;
  const indexById = new Map<string, number>();
  const idsWithDeltas = new Set<string>();

  // Anthropic streams a thinking block as text deltas plus one empty-text delta
  // carrying the signature in providerMetadata (and redacted blocks as
  // redactedData). The signature rides on the *same* id, so the block is
  // buffered and emitted exactly once on `reasoning-end`.
  const reasoningById = new Map<string, ReasoningBuffer>();

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        yield textDeltaChunk(part.text);
        break;

      case 'reasoning-delta': {
        const entry = reasoningById.get(part.id) ?? { text: '' };
        entry.text += part.text;
        const anthropic = part.providerMetadata?.anthropic;
        const signature = anthropic?.signature;
        if (typeof signature === 'string') entry.signature = signature;
        const redactedData = anthropic?.redactedData;
        if (typeof redactedData === 'string') entry.redactedData = redactedData;
        reasoningById.set(part.id, entry);
        break;
      }

      case 'reasoning-end': {
        yield* drainReasoning(part.id, reasoningById);
        break;
      }

      case 'tool-input-start': {
        const index = toolCallCounter++;
        indexById.set(part.id, index);
        yield toolStartChunk(index, part.id, part.toolName);
        break;
      }

      case 'tool-input-delta': {
        const index = indexById.get(part.id);
        if (index === undefined) {
          throw new Error(`tool-input-delta for unknown tool input id '${part.id}'`);
        }
        idsWithDeltas.add(part.id);
        yield toolArgumentsDeltaChunk(index, part.delta);
        break;
      }

      case 'tool-call': {
        // A provider that streams only the final tool-call (no input deltas)
        // leaves MessageAccumulator with empty arguments. Synthesize one delta
        // carrying the full JSON so the accumulator sees complete arguments.
        if (!idsWithDeltas.has(part.toolCallId)) {
          let index = indexById.get(part.toolCallId);
          if (index === undefined) {
            index = toolCallCounter++;
            indexById.set(part.toolCallId, index);
            yield toolStartChunk(index, part.toolCallId, part.toolName);
          }
          yield toolArgumentsDeltaChunk(index, JSON.stringify(part.input));
        }
        break;
      }

      case 'error': {
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }

      case 'finish': {
        // An unterminated reasoning block must not be silently dropped.
        for (const id of [...reasoningById.keys()]) {
          yield* drainReasoning(id, reasoningById);
        }
        yield finishChunk(part.finishReason);
        break;
      }

      default:
        break;
    }
  }

  const warnings = await warningsPromise;
  if (warnings) {
    for (const raw of warnings) {
      const warning = describeWarning(raw);
      logWarning(warning);
      if (warning.type === 'unsupported' && namesRequestedCapability(warning)) {
        throw new Error(
          `provider did not apply requested capability '${warning.feature}'` +
            (warning.details ? `: ${warning.details}` : ''),
        );
      }
    }
  }
}

/**
 * Emit at most one legacy delta for a buffered reasoning block and drop it from
 * the map. Emitting both a signature-carrying block and an unsigned
 * `reasoning_content` would duplicate the reasoning in history, and Anthropic
 * rejects the unsigned copy.
 */
function drainReasoning(
  id: string,
  buffers: Map<string, ReasoningBuffer>,
): LiteLLMStreamedChunk[] {
  const entry = buffers.get(id);
  if (!entry) return [];
  buffers.delete(id);

  if (entry.signature !== undefined) {
    const block: ThinkingAnthropic = {
      type: 'thinking',
      thinking: entry.text,
      signature: entry.signature,
    };
    return [deltaChunk({ reasoning_content: undefined, thinking_blocks: [block] })];
  }

  if (entry.redactedData !== undefined) {
    const block: ThinkingAnthropic = { type: 'redacted_thinking', data: entry.redactedData };
    return [deltaChunk({ reasoning_content: undefined, thinking_blocks: [block] })];
  }

  if (entry.text.length === 0) return [];

  return [deltaChunk({ reasoning_content: entry.text })];
}

type DescribedWarning = { type: string; feature: string; details?: string };

function describeWarning(warning: CallWarning): DescribedWarning {
  if ('feature' in warning) {
    return { type: warning.type, feature: warning.feature, details: warning.details };
  }
  if ('setting' in warning) {
    return { type: warning.type, feature: warning.setting, details: warning.message };
  }
  return { type: warning.type, feature: String(warning) };
}

function logWarning(warning: DescribedWarning): void {
  const details = warning.details ? ` — ${warning.details}` : '';
  console.warn(`[llm] ${warning.type} warning: ${warning.feature}${details}`);
}

function namesRequestedCapability(warning: DescribedWarning): boolean {
  const feature = warning.feature.toLowerCase();
  return REQUESTED_CAPABILITIES.some((capability) => feature.includes(capability));
}

const INDEX = 0;

function deltaChunk(delta: LiteLLMDelta): LiteLLMStreamedChunk {
  return { choices: [{ index: INDEX, delta, finish_reason: null }] } as unknown as LiteLLMStreamedChunk;
}

function textDeltaChunk(text: string): LiteLLMStreamedChunk {
  return deltaChunk({ content: text });
}

function toolStartChunk(index: number, id: string, toolName: string): LiteLLMStreamedChunk {
  return deltaChunk({
    tool_calls: [
      { index, id, type: 'function', function: { name: toolName, arguments: '' } },
    ],
  });
}

function toolArgumentsDeltaChunk(index: number, deltaText: string): LiteLLMStreamedChunk {
  return deltaChunk({
    tool_calls: [{ index, function: { arguments: deltaText } }],
  });
}

function finishChunk(reason: FinishReason): LiteLLMStreamedChunk {
  // Map to the legacy literals chat-loop switches on. Anything outside the
  // named cases is emitted verbatim so chat-loop's `default` branch raises a
  // RUN_ERROR (no silent truncation).
  let finishReason: string;
  switch (reason) {
    case 'tool-calls':
      finishReason = 'tool_calls';
      break;
    case 'stop':
      finishReason = 'stop';
      break;
    case 'length':
      finishReason = 'length';
      break;
    case 'content-filter':
      finishReason = 'content_filter';
      break;
    default:
      finishReason = reason;
  }
  return {
    choices: [{ index: INDEX, delta: {}, finish_reason: finishReason }],
  } as unknown as LiteLLMStreamedChunk;
}