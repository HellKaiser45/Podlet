import type { LanguageModelUsage } from 'ai';

/**
 * Flattened usage for the roadmap P1 usage-accounting item. Field values are
 * kept exactly as the SDK reports them: `undefined` stays `undefined` (it means
 * "the provider did not report this", not zero). Not wired into persistence yet.
 */
export type NormalizedUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  cacheReadTokens: number | undefined;
  cacheWriteTokens: number | undefined;
  reasoningTokens: number | undefined;
};

export function normalizeUsage(usage: LanguageModelUsage | undefined): NormalizedUsage {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
  };
}