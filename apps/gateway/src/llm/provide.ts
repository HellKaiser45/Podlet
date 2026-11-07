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
 *
 * `headers` here reach the wire: every factory forwards its configured headers
 * into the request via `combineHeaders(config.headers, options.headers)` — see
 * the cited file:line in each case below.
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
        // @ai-sdk/openai dist/index.js:1915
        //   headers: combineHeaders(await resolve(this.config.headers), options.headers)
        return createOpenAI(settings).chat(modelId);
      }
      if (resolved.base_url === undefined) {
        throw new Error(`provider '${name}': base_url required for an openai-compatible endpoint`);
      }
      // @ai-sdk/openai-compatible dist/index.js:489
      //   headers: combineHeaders(await resolve(this.config.headers), options.headers)
      return createOpenAICompatible({
        name,
        apiKey: resolved.api_key,
        baseURL: resolved.base_url,
        headers: resolved.headers,
        // Without this the compatible provider never requests usage at all:
        // `stream_options` is sent only when this flag is truthy
        // (@ai-sdk/openai-compatible dist/index.js:547). Endpoints that reject
        // unknown request fields declare `no_stream_options` to opt out.
        includeUsage: resolved.quirks.no_stream_options !== true,
      }).chatModel(modelId);
    }
    case 'anthropic':
      // @ai-sdk/anthropic dist/index.js:4623
      //   combineHeaders(configHeaders, headers, ...)
      return createAnthropic(settings).chat(modelId);
    case 'google':
      // @ai-sdk/google dist/index.js:2079
      //   headers: combineHeaders(await resolve(this.config.headers), options.headers, extraHeaders)
      return createGoogleGenerativeAI(settings).chat(modelId);
    default:
      throw new Error(
        `unsupported protocol '${String(resolved.protocol)}' for model provider '${name}'`,
      );
  }
}

/**
 * Does this provider name point at the SDK's own canonical OpenAI endpoint?
 */
function isCanonicalOpenAI(providerName: string, protocol: Protocol): boolean {
  return protocol === 'openai' && providerName === 'openai';
}