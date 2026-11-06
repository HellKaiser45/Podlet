import type { AgentThinking, Protocol, ProviderQuirks } from '../types';

/**
 * Map an agent's thinking tier onto provider-specific options.
 *
 * The tier is positional on the provider's own scale. `low`/`medium` are sent
 * as the provider's own low/medium, and `high` is sent as the provider's
 * top-of-scale value (OpenAI `'max'`, Anthropic a 32000-token budget, Google
 * `'high'`). This matches the owner's stated Anthropic intent (low/medium/max)
 * while keeping identity for the lower two tiers.
 *
 * `none` (and unset) sends nothing at all: no providerOptions block.
 *
 * Anthropic note: `{ type: 'adaptive' }` is the newer Anthropic thinking path,
 * and a fixed `budgetTokens` may warn on the newest Claude models. We keep the
 * enabled+budget form here deliberately and do NOT add an fallback — a silent
 * downgrade would hide that the requested tier was not applied.
 */
export function buildProviderOptions(
  protocol: Protocol,
  thinking: AgentThinking | undefined,
  quirks: ProviderQuirks,
): Record<string, Record<string, unknown>> {
  const level = thinking ?? 'none';
  if (level === 'none') return {};

  // A model that rejects reasoning_effort must not silently drop a tier the
  // agent asked for. `thinkingQuirkConflict` in agent_client guards this before
  // the request is built; this is the second, local guard.
  if (quirks.no_reasoning_effort) {
    throw new Error(
      `this provider rejects reasoning_effort; thinking '${level}' cannot be honored`,
    );
  }

  switch (protocol) {
    case 'openai': {
      const reasoningEffort = level === 'high' ? 'max' : level;
      return { openai: { reasoningEffort } };
    }
    case 'anthropic': {
      const budgetTokens = level === 'low' ? 1024 : level === 'medium' ? 8192 : 32000;
      return {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens },
          sendReasoning: true,
        },
      };
    }
    case 'google': {
      return {
        google: {
          thinkingConfig: { thinkingLevel: level, includeThoughts: true },
        },
      };
    }
  }
}