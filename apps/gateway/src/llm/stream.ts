import type {
  FinishReason,
  LanguageModel,
  ModelMessage,
  ToolSet,
} from 'ai';
import { streamText } from 'ai';
import type { LiteLLMDelta, LiteLLMStreamedChunk, ThinkingAnthropic } from '../types';
import type { ReasoningLevel } from './thinking';
import { normalizeUsage } from './usage';
import { createWarningLogger, describeWarning, namesRequestedCapability } from './warnings';

/**
 * We own warning output for this process.
 *
 * The `ai` package prints every warning itself by default, which is what
 * produced the duplicate `(node:…) Warning: AI SDK Warning (provider / model): …`
 * line next to our own `[llm] … warning: …`. Its printer is read from this
 * global (ai/dist/index.js:642: `const logger = globalThis.AI_SDK_LOG_WARNINGS;`
 * → `if (typeof logger === "function") { logger(options); return; }`).
 *
 * A no-op FUNCTION rather than `false`: `false` still lets the SDK print its
 * `FIRST_WARNING_INFO_MESSAGE` info line, which is noise here.
 */
(globalThis as any).AI_SDK_LOG_WARNINGS = () => {};

const warningLogger = createWarningLogger();

export type RunLlmStreamOptions = {
  model: LanguageModel;
  /** Sent via streamText's `system` option. Omitted when the caller has already
   *  put the system prompt into `messages` (needed for Anthropic cache breaks). */
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  /** Kept for future provider-specific needs. Thinking no longer writes here. */
  providerOptions?: Record<string, Record<string, unknown>>;
  /**
   * Portable, provider-agnostic reasoning tier. Mapped per protocol by the
   * caller (`mapReasoning`); `undefined` omits the option entirely.
   */
  reasoning?: ReasoningLevel;
  abortSignal?: AbortSignal;
};

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
    // The portable reasoning option: streamText's settings type is
    // LanguageModelCallOptions, which declares
    //   reasoning?: LanguageModelV4CallOptions['reasoning']
    // (ai dist/index.d.ts:765), and that union is
    //   'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' |
    //   'xhigh' | 'max'
    // (@ai-sdk/provider dist/index.d.ts:1576).
    reasoning: options.reasoning,
    // A 'system' role entry in `messages` is rejected unless this is set
    // (ai dist/index.js:2246). Only the Anthropic path puts it there.
    allowSystemInMessages: true,
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
        // `totalUsage` is the field on the finish part: TextStreamFinishPart is
        // { type: 'finish'; finishReason; rawFinishReason; totalUsage }
        // (ai dist/index.d.ts:3163-3168).
        logUsage(part.totalUsage);
        yield finishChunk(part.finishReason);
        break;
      }

      default:
        break;
    }
  }

  const warnings = await warningsPromise;
  if (warnings) {
    const scope = warningScope(options.model);
    for (const raw of warnings) {
      const warning = describeWarning(raw);
      warningLogger.log(warning, scope);
      // Deliberately outside the dedupe: a dropped requested capability must
      // fail every call, not just the first one that reported it.
      if (warning.type === 'unsupported' && namesRequestedCapability(warning)) {
        throw new Error(
          `provider did not apply requested capability '${warning.feature}'` +
            (warning.details ? `: ${warning.details}` : ''),
        );
      }
    }
  }
}

/** One structured usage line per call. Nothing is persisted. */
function logUsage(usage: Parameters<typeof normalizeUsage>[0]): void {
  const normalized = normalizeUsage(usage);
  console.log(
    `[llm] usage input=${fmt(normalized.inputTokens)} output=${fmt(normalized.outputTokens)}` +
      ` total=${fmt(normalized.totalTokens)} cacheRead=${fmt(normalized.cacheReadTokens)}` +
      ` cacheWrite=${fmt(normalized.cacheWriteTokens)} reasoning=${fmt(normalized.reasoningTokens)}`,
  );
}

function fmt(value: number | undefined): string {
  return value === undefined ? 'n/a' : String(value);
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

/**
 * `<provider> <modelId>` for warnings, so two models emitting the same
 * compatibility warning each get one line. `LanguageModel` is a union, so the
 * two fields are probed at runtime; absent (or non-string) means no scope.
 */
function warningScope(model: LanguageModel): string | undefined {
  const provider = (model as any).provider;
  const modelId = (model as any).modelId;
  if (typeof provider !== 'string' || typeof modelId !== 'string') return undefined;
  return `${provider} ${modelId}`;
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