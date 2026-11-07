import type { LanguageModelUsage } from 'ai';

/**
 * Hard cap on the serialized provider `raw` usage blob. Anthropic's `raw` grows
 * with the number of tool-loop iterations, so an unbounded column is a
 * long-run storage risk. The stored value must always remain valid JSON.
 */
export const RAW_USAGE_MAX_LENGTH = 65536;

/**
 * Flattened usage for the roadmap P1 usage-accounting item. Field values are
 * kept exactly as the SDK reports them: `undefined` stays `undefined` (it means
 * "the provider did not report this", not zero).
 *
 * COMPARABILITY WARNING for `noCacheTokens` / `textTokens`: they are NOT
 * comparable across protocols.
 *   - openai-compatible: `noCache = prompt - cacheRead`, `text = completion - reasoning`
 *   - anthropic:         `noCache = inputTokens` (cache EXCLUDED entirely)
 * Summing them across a mixed-provider run is meaningless; render per model.
 *
 * CACHE TOKENS ARE A SUBSET OF INPUT TOKENS. `cacheReadTokens` /
 * `cacheWriteTokens` are already contained in `inputTokens` on the protocols
 * that report them. Never add them to `inputTokens`.
 */
export type NormalizedUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  cacheReadTokens: number | undefined;
  cacheWriteTokens: number | undefined;
  noCacheTokens: number | undefined;
  reasoningTokens: number | undefined;
  textTokens: number | undefined;
  usageReported: boolean;
  rawJson: string | undefined;
  rawTruncated: boolean;
};

export function normalizeUsage(usage: LanguageModelUsage | undefined): NormalizedUsage {
  const raw = usage?.raw;
  let rawJson: string | undefined;
  let rawTruncated = false;

  if (raw !== undefined) {
    const serialized = JSON.stringify(raw);
    if (serialized.length > RAW_USAGE_MAX_LENGTH) {
      // Never store a half-written string: the column is read back as JSON.
      rawJson = JSON.stringify({ __truncated: true, originalLength: serialized.length });
      rawTruncated = true;
    } else {
      rawJson = serialized;
    }
  }

  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
    noCacheTokens: usage?.inputTokenDetails?.noCacheTokens,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
    textTokens: usage?.outputTokenDetails?.textTokens,
    // `raw !== undefined` means the provider produced a usage object. Note that
    // anthropic always pre-seeds a zero accumulator and ends with
    // `raw: rawUsage ?? usage`, so this is always `true` there by SDK design —
    // the flag is uninformative on anthropic; `rawJson` is the audit trail.
    usageReported: raw !== undefined,
    rawJson,
    rawTruncated,
  };
}

/** How one LLM call terminated. */
export type LlmOutcome = 'finish' | 'error' | 'incomplete';

/**
 * What the adapter knows about one call: it has no `agentId`, `protocol` or
 * model key, so identity is assembled by the caller.
 */
export type LlmCallOutcome = {
  /** Minted once per call by the adapter. No caller may re-mint it. */
  callId: string;
  outcome: LlmOutcome;
  /** Mapped exactly like the terminal chunk's `finish_reason`, or 'error' /
   *  'incomplete' when no provider finish reason exists. */
  finishReason: string;
  /** All-undefined with `usageReported: false` for 'error' / 'incomplete'. */
  usage: NormalizedUsage;
};

/**
 * One row of the usage table: the adapter's outcome plus the identity the
 * caller owns. Assembled by `chatStream` in the persistence phase.
 */
export type UsageRecord = LlmCallOutcome & {
  runId: string;
  frameId: string;
  parentFrameId: string | undefined;
  agentId: string;
  /** models.json key, e.g. "fast". */
  model: string;
  provider: string;
  protocol: string;
  /** Computed, never a constant: was usage requested from this endpoint? */
  usageRequested: boolean;
};