import type { AgentThinking, Protocol, ProviderQuirks } from '../types';

/**
 * The AI SDK's portable call-level reasoning scale
 * (`LanguageModelV4CallOptions['reasoning']` in @ai-sdk/provider).
 */
export type ReasoningLevel =
  | 'provider-default'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

/**
 * The top of each provider's own scale, which is where the agent's `high` tier
 * lands. The three providers do NOT share a top value:
 *
 *  - OpenAI's effort enum includes 'max'
 *    (@ai-sdk/openai dist/index.d.ts:54
 *     `reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max" | "minimal"`).
 *  - Anthropic's effort enum includes 'max' (@ai-sdk/anthropic dist/index.js:1422).
 *  - Google's thinkingLevel enum is only minimal|low|medium|high
 *    (@ai-sdk/google dist/index.js:878-884), and its reasoning mapper
 *    (@ai-sdk/google dist/index.js:2669-2678) has no 'max' entry, so sending
 *    'max' there would raise an unsupported warning instead of applying.
 */
const TOP_OF_SCALE: Record<Protocol, ReasoningLevel> = {
  openai: 'max',
  anthropic: 'max',
  google: 'high',
};

/**
 * Map an agent's thinking tier onto the SDK's portable `reasoning` option.
 *
 * Returns `undefined` for `none`/unset: the option is omitted entirely rather
 * than sent as `reasoning: 'none'`, because 'none' means "disable reasoning"
 * to a provider that supports it, which is not the same as "say nothing".
 *
 * No providerOptions block is written any more: the hand-built
 * `thinking: { type: 'enabled', budgetTokens }` form is downgraded by the SDK to
 * adaptive on newer Anthropic models (@ai-sdk/anthropic dist/index.js:4370), and
 * the resulting `unsupported` warning made stream.ts throw. The portable option
 * is mapped by the provider itself and cannot be rejected that way.
 */
export function mapReasoning(
  protocol: Protocol,
  thinking: AgentThinking | undefined,
  quirks: ProviderQuirks,
): ReasoningLevel | undefined {
  const level = thinking ?? 'none';
  if (level === 'none') return undefined;

  // A model that rejects reasoning_effort must not silently drop a tier the
  // agent asked for. `thinkingQuirkConflict` in agent_client guards this before
  // the request is built; this is the second, local guard.
  if (quirks.no_reasoning_effort) {
    throw new Error(
      `this provider rejects reasoning_effort; thinking '${level}' cannot be honored`,
    );
  }

  if (level === 'high') return TOP_OF_SCALE[protocol];
  return level;
}