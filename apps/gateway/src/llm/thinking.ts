import type { AgentThinking, Protocol, ProviderQuirks } from '../types';
import { providerOptionsNamespace } from './provide';

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
 * The OUTER key is the namespace the *instantiated provider* resolves, not the
 * wire protocol. `@ai-sdk/openai-compatible` reads
 * `providerOptions[config.provider.split('.')[0].trim()]`
 * (node_modules/@ai-sdk/openai-compatible/src/chat/
 * openai-compatible-chat-language-model.ts:179) and ignores every other key
 * without a warning, so a provider constructed as `name: 'opencode'` only ever
 * sees `providerOptions.opencode`. Emitting `providerOptions.openai` there
 * silently discards the agent's thinking setting. That is why `providerName` is
 * a required parameter with no default: there is no safe namespace to guess.
 *
 * Anthropic note: `{ type: 'adaptive' }` is the newer Anthropic thinking path,
 * and a fixed `budgetTokens` may warn on the newest Claude models. We keep the
 * enabled+budget form here deliberately and do NOT add a fallback — a silent
 * downgrade would hide that the requested tier was not applied.
 */
export function buildProviderOptions(
  protocol: Protocol,
  thinking: AgentThinking | undefined,
  quirks: ProviderQuirks,
  providerName: string,
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

  // Throws when the namespace cannot be expressed at all, so a level is never
  // dropped on the floor.
  const namespace = providerOptionsNamespace(providerName, protocol);

  switch (protocol) {
    case 'openai': {
      // Verified against the installed packages: both @ai-sdk/openai
      // (src/chat/openai-chat-language-model-options.ts:116, enum includes
      // 'max') and @ai-sdk/openai-compatible (src/chat/
      // openai-compatible-chat-language-model-options.ts:18) accept
      // `reasoningEffort`; the compatible model forwards it as the
      // `reasoning_effort` request field.
      const reasoningEffort = level === 'high' ? 'max' : level;
      return { [namespace]: { reasoningEffort } };
    }
    case 'anthropic': {
      // Verified: src/anthropic-language-model-options.ts:149 `sendReasoning`
      // and :205 `thinking.budgetTokens`, read at
      // src/anthropic-language-model.ts:793-795. Names are correct as-is.
      const budgetTokens = level === 'low' ? 1024 : level === 'medium' ? 8192 : 32000;
      return {
        [namespace]: {
          thinking: { type: 'enabled', budgetTokens },
          sendReasoning: true,
        },
      };
    }
    case 'google': {
      // Verified: src/google-language-model-options.ts:70-76 reads
      // `thinkingConfig.thinkingBudget | includeThoughts | thinkingLevel`,
      // with thinkingLevel an enum of minimal|low|medium|high. Names are
      // correct as-is and our tiers are all inside the enum.
      return {
        [namespace]: {
          thinkingConfig: { thinkingLevel: level, includeThoughts: true },
        },
      };
    }
  }
}