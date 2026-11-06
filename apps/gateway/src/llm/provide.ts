import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ResolvedModel } from '../system/providers';

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
      if (name === 'openai') {
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