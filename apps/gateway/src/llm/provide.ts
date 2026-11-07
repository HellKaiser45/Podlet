import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ResolvedModel } from '../system/providers';
import type { Protocol } from '../types';

/**
 * Build the in-process LanguageModel for a resolved model entry.
 *
 * An explicit provider instance is always returned — never a bare model id
 * string, which `streamText` would route through Vercel's AI Gateway.
 *
 * Method names differ between packages (measured from the installed .d.ts):
 *   - @ai-sdk/openai            -> createOpenAI(...).chat(modelId)
 *   - @ai-sdk/openai-compatible -> createOpenAICompatible(...).chatModel(modelId)
 *   - @ai-sdk/anthropic         -> createAnthropic(...).chat(modelId)
 *   - @ai-sdk/google            -> createGoogleGenerativeAI(...).chat(modelId)
 */
export function buildLanguageModel(
  name: string,
  resolved: ResolvedModel,
  modelId: string,
): LanguageModel {
  const settings = {
    apiKey: resolved.api_key,
    baseURL: resolved.base_url,
    headers: resolved.headers,
  };

  switch (resolved.protocol) {
    case 'openai': {
      // The OpenAI SDK factory is only used for the canonical OpenAI endpoint;
      // every other openai-protocol provider is a third-party compatible
      // endpoint reached through the compatible factory.
      if (isCanonicalOpenAI(name, resolved.protocol)) {
        return createOpenAI(settings).chat(modelId);
      }
      if (resolved.base_url === undefined) {
        throw new Error(`provider '${name}': base_url required for an openai-compatible endpoint`);
      }
      return createOpenAICompatible({
        name,
        apiKey: resolved.api_key,
        baseURL: resolved.base_url,
        headers: resolved.headers,
      }).chatModel(modelId);
    }
    case 'anthropic':
      return createAnthropic(settings).chat(modelId);
    case 'google':
      return createGoogleGenerativeAI(settings).chat(modelId);
    default:
      throw new Error(
        `unsupported protocol '${String(resolved.protocol)}' for model provider '${name}'`,
      );
  }
}

/**
 * Does this provider name point at the SDK's own canonical OpenAI endpoint?
 * Shared by the factory above and `providerOptionsNamespace` below so the
 * constructed instance and the options key can never disagree.
 */
function isCanonicalOpenAI(providerName: string, protocol: Protocol): boolean {
  return protocol === 'openai' && providerName === 'openai';
}

/**
 * The `providerOptions` namespace the instance built by `buildLanguageModel`
 * actually reads. Measured from the installed SDK, not inferred:
 *
 *   - @ai-sdk/openai: the chat model calls
 *     `parseProviderOptions({ provider: 'openai', ... })` with a hardcoded
 *     literal (src/chat/openai-chat-language-model.ts:118-123), so the
 *     canonical instance reads `providerOptions.openai` regardless of factory
 *     arguments.
 *   - @ai-sdk/openai-compatible: the key is the INSTANCE NAME —
 *     `this.config.provider.split('.')[0].trim()`
 *     (src/chat/openai-compatible-chat-language-model.ts:179-181), where
 *     `config.provider` is `` `${options.name}.${modelType}` ``
 *     (src/openai-compatible-provider.ts:149,170). A provider constructed as
 *     `name: 'opencode'` therefore reads `providerOptions.opencode` only.
 *   - @ai-sdk/anthropic: hardcoded `provider: 'anthropic'`
 *     (src/anthropic-language-model.ts:444-448), so the model's `provider`
 *     string never affects the key.
 *   - @ai-sdk/google: every non-Vertex instance reads `providerOptions.google`
 *     (src/google-language-model.ts:175-186).
 *
 * Throws when the name cannot be resolved to a key the SDK reads, because an
 * unresolvable namespace means the requested option is silently dropped.
 */
export function providerOptionsNamespace(providerName: string, protocol: Protocol): string {
  switch (protocol) {
    case 'openai': {
      if (isCanonicalOpenAI(providerName, protocol)) return 'openai';
      // The compatible model truncates the instance name at the first dot: it
      // reads `providerOptions[provider.split('.')[0]]`, so a dotted name would
      // mean the emitted key is never looked up.
      if (providerName.includes('.')) {
        throw new Error(
          `provider '${providerName}': @ai-sdk/openai-compatible reads providerOptions under '${providerName.split('.')[0]}' (it truncates the name at the first dot), so thinking could not be applied; rename the provider without a '.' so the option reaches the model`,
        );
      }
      return providerName;
    }
    case 'anthropic':
      return 'anthropic';
    case 'google':
      return 'google';
    default:
      throw new Error(
        `unsupported protocol '${String(protocol)}' for provider '${providerName}'`,
      );
  }
}