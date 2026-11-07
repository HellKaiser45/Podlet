import type { ChatCompletionChunk, ChatCompletionMessage, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { ModelMessage, ToolSet } from 'ai';
import type { AgentThinking, LiteLLMStreamedChunk, ThinkingAnthropic, LiteLLMDelta, LiteLLMMessage, Protocol } from './types';
import AppContainer from './runtime';
import { getCoreToolDefinitions } from './tools/core/core_tools';
import { VirtualFileSystem } from './system/sandbox';
import { hydrateVisionHistory } from './system/vision-hydrate';
import { thinkingQuirkConflict, type ResolvedModel } from './system/providers';
import { buildLanguageModel } from './llm/provide';
import { mapReasoning } from './llm/thinking';
import { toModelMessages, toToolSet, withCacheControl } from './llm/messages';
import { computeConversationId, conversationHeaders } from './llm/conversation';
import { runLlmStream } from './llm/stream';
import { findUnenforceableSchemaKeywords, keywordsUnenforceableOn } from './llm/schema-compat';
import { createWarningLogger } from './llm/warnings';
import type { ChatCompletionTool } from '@podlet/types';

/** A fully-resolved in-process LLM request (no HTTP transport). */
type ResolvedRequest = {
  agentId: string;
  /** The model's `provider` name, used to pick the SDK factory. */
  providerName: string;
  protocol: Protocol;
  modelId: string;
  resolved: ResolvedModel;
  /** The stable half (skills + agent prompt): cached on anthropic. */
  stableSystem: string;
  /** The per-turn half (context tree): never cached. */
  volatileSystem: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  thinking: AgentThinking;
  responseFormat?: Record<string, any>;
};

export class AgentClient {
  private readonly appContainer: AppContainer

  constructor(appcontainer: AppContainer) {
    this.appContainer = appcontainer;
  }

  private async buildRequest(agentId: string, history: LiteLLMMessage[], vfileSystem: VirtualFileSystem): Promise<ResolvedRequest> {
    const agent = this.appContainer.agentManager.agents[agentId];
    const model = this.appContainer.modelManager.models[agent.model];
    if (!model) {
      throw new Error(`model '${agent.model}': not found in models.json`);
    }
    const tools = [
      ...this.appContainer.mcpManager.getTools(agent.mcps || []),
      ...getCoreToolDefinitions(),
      ...await this.appContainer.agentToolsManager.getAgentAsToolDefinition(agent.subAgents || []),
    ];

    const visionEnabled = this.appContainer.initConfig.vision?.enabled !== false;
    const gatedTools = visionEnabled
      ? tools
      : tools.filter((tool: any) => tool?.function?.name !== 'see_image');

    const systemPrompt = await this.appContainer.skillManager.injectSkills(agent.skills || [], await this.appContainer.agentManager.getAgentprompt(agentId), vfileSystem);
    const updatedSystemPrompt = await vfileSystem.getContextTree()

    const hydrated = await hydrateVisionHistory(history, vfileSystem);

    // Thinking is an agent setting, positional on the provider's own scale: the
    // agent's value is what travels as the provider thinking option; `none` (and
    // unset) sends nothing at all. A model whose provider rejects the parameter
    // may not silently drop a capability the agent asked for, so that combination
    // fails here — before any request is made.
    const thinking = (agent.thinking ?? "none") as AgentThinking;
    const resolved = this.appContainer.modelManager.resolve(agent.model);
    // A model already classified `unusable` is never dispatched: its reason
    // names the offending field and the fix, and sending the request anyway
    // replaces that with an opaque provider error. Runs before the quirk check
    // so a legacy-key model reports the real problem.
    if (!resolved || resolved.health.status === "unusable") {
      throw new Error(resolved?.health.reason ?? `model '${agent.model}': unusable`);
    }
    if (!resolved.protocol) {
      throw new Error(`model '${agent.model}': no protocol resolved`);
    }
    const conflict = thinkingQuirkConflict(agent.model, agentId, agent.thinking, resolved);
    if (conflict) throw new Error(conflict);

    // Diagnostics only: names which TOOL carries a keyword the protocol drops,
    // so the provider's own warning (which only names the model) is actionable.
    // The schemas are reported, never rewritten.
    reportUnenforceableSchemaKeywords(gatedTools, resolved.protocol);

    return {
      agentId,
      providerName: model.provider,
      protocol: resolved.protocol,
      modelId: model.model,
      resolved,
      stableSystem: systemPrompt,
      volatileSystem: updatedSystemPrompt,
      messages: toModelMessages(hydrated),
      tools: gatedTools.length > 0 ? toToolSet(gatedTools) : undefined,
      thinking,
      responseFormat: agent.response_format,
    };
  }

  async *chatStream(agentId: string, history: LiteLLMMessage[], vfileSystem: VirtualFileSystem): AsyncGenerator<LiteLLMStreamedChunk, void, unknown> {
    const request = await this.buildRequest(agentId, history, vfileSystem);

    // `providerName` is the string handed to the provider factory, which is the
    // namespace the SDK resolves providerOptions under — not the protocol.
    const providerOptions: Record<string, Record<string, unknown>> = {};
    this.applyResponseFormat(request, providerOptions);

    const conversationId = computeConversationId(history);
    const modelHeaders = {
      ...request.resolved.headers,
      ...conversationHeaders(conversationId, request.resolved.quirks),
    };
    const languageModel = buildLanguageModel(
      request.providerName,
      { ...request.resolved, headers: modelHeaders },
      request.modelId,
    );

    // Only anthropic has per-part cacheControl. For that protocol the system
    // prompt is sent as entries in `messages` so each part can carry a
    // breakpoint; every other protocol keeps streamText's `system` option.
    const useCacheControl = request.protocol === 'anthropic' && !request.resolved.quirks.no_cache_control;
    const messages = useCacheControl
      ? withCacheControl(
          request.messages,
          { stable: request.stableSystem, volatile: request.volatileSystem },
          request.resolved.quirks,
        )
      : request.messages;

    yield* runLlmStream({
      model: languageModel,
      // Omitted on the cache-control path: the system prompt is in `messages`
      // there. Sending both would duplicate the whole system prompt.
      system: useCacheControl
        ? undefined
        : request.stableSystem + `\n\n` + request.volatileSystem,
      messages,
      tools: request.tools,
      providerOptions: Object.keys(providerOptions).length > 0
        ? providerOptions
        : undefined,
      // `undefined` omits the option entirely: `none` sends nothing at all.
      reasoning: mapReasoning(request.protocol, request.thinking, request.resolved.quirks),
      // The usage record is assembled HERE in a later phase: `chatStream` owns
      // the identity the adapter cannot know (runId, frameId, agentId, model
      // key, protocol). Until then the callback is a no-op.
      onUsage: () => {},
    });
  }

  /**
   * Honor `agent.response_format` per protocol. NO silent omission: a value that
   * the chosen provider cannot express throws, naming the setting.
   */
  private applyResponseFormat(
    request: ResolvedRequest,
    providerOptions: Record<string, Record<string, unknown>>,
  ): void {
    const responseFormat = request.responseFormat;
    if (!responseFormat) return;

    if (request.protocol === 'anthropic') {
      throw new Error(
        `agent '${request.agentId}': response_format is unsupported on the anthropic protocol`,
      );
    }

    if (request.protocol === 'openai') {
      // @ai-sdk/openai exposes no responseFormat option on the chat model; there
      // is no supported way to forward the raw OpenAI response_format object.
      throw new Error(
        `agent '${request.agentId}': response_format is set, but the @ai-sdk/openai provider exposes no responseFormat option; the setting cannot be honored`,
      );
    }

    // google: map to the provider's structured-output responseFormat option.
    const type = responseFormat.type;
    if (type === 'json_schema') {
      const schema = responseFormat.json_schema?.schema;
      providerOptions.google = {
        ...(providerOptions.google ?? {}),
        responseFormat: [{ type: 'text', schema }],
      };
      return;
    }
    if (type === 'json_object') {
      providerOptions.google = {
        ...(providerOptions.google ?? {}),
        responseFormat: [{ type: 'text', mimeType: 'application/json' }],
      };
      return;
    }
    throw new Error(
      `agent '${request.agentId}': response_format type '${String(type)}' is unsupported on the google protocol`,
    );
  }
}

/**
 * Process-wide, so one line per unique (tool, keyword) for the whole run: the
 * request is rebuilt on every tool-loop iteration.
 */
const schemaWarningLogger = createWarningLogger();

/**
 * Log one line per unique (toolName, keyword) when the protocol cannot enforce
 * the keyword. Silent for a protocol that enforces it, and silent when no tool
 * carries one.
 */
function reportUnenforceableSchemaKeywords(
  tools: ChatCompletionTool[],
  protocol: Protocol,
): void {
  try {
    const unenforceable = new Set(keywordsUnenforceableOn(protocol).map((entry) => entry.keyword));
    if (unenforceable.size === 0) return;

    for (const occurrence of findUnenforceableSchemaKeywords(tools)) {
      if (!unenforceable.has(occurrence.keyword)) continue;
      schemaWarningLogger.note(
        `schema|${occurrence.toolName}|${occurrence.keyword}`,
        `[llm] tool '${occurrence.toolName}' schema uses ${occurrence.keyword}` +
          ` (${occurrence.path}) \u2014 ${protocol} protocol cannot enforce it`,
      );
    }
  } catch {
    // Diagnostics must never fail a request, whatever a hostile schema does.
  }
}

export class MessageAccumulator {
  private content: string = "";
  private reasoningContent: string = "";
  private thinkingBlocks: ThinkingAnthropic[] = [];
  private toolCalls: Record<number, Partial<ChatCompletionChunk.Choice.Delta.ToolCall>> = {};

  constructMessage(delta: LiteLLMDelta) {
    if (delta.reasoning_content) this.reasoningContent += delta.reasoning_content;
    if (delta.content) this.content += delta.content;
    if (delta.thinking_blocks) this.thinkingBlocks.push(...delta.thinking_blocks);

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = this.toolCalls[tc.index];
        if (existing) {
          if (tc.id) this.toolCalls[tc.index].id = tc.id;
          if (tc.function?.name) existing.function!.name = tc.function.name;
          if (tc.function?.arguments) existing.function!.arguments += tc.function.arguments;
        } else {
          this.toolCalls[tc.index] = {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function?.name || "",
              arguments: tc.function?.arguments || "",
            }
          }
        }
      }
    }
  }

  buildMessage(): ChatCompletionMessage & { reasoning_content?: string; thinking_blocks?: ThinkingAnthropic[]; } {
    const toolCallsArray: ChatCompletionMessageToolCall[] = Object.entries(this.toolCalls)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([, tc]) => tc)
      .filter((tc): tc is Partial<ChatCompletionChunk.Choice.Delta.ToolCall> & { id: string; type: 'function'; function: { name: string; arguments: string } } =>
        tc.id !== undefined &&
        tc.type === 'function' &&
        tc.function !== undefined
      )
      .map(tc => ({
        id: tc.id!,
        type: 'function' as const,
        function: {
          name: tc.function!.name || "",
          arguments: tc.function!.arguments || "",
        }
      }));

    const baseMessage: ChatCompletionMessage = {
      role: "assistant",
      content: this.content || null,
      tool_calls: toolCallsArray.length > 0 ? toolCallsArray : undefined,
      refusal: null,
    };

    return {
      ...baseMessage,
      reasoning_content: this.reasoningContent || undefined,
      thinking_blocks: this.thinkingBlocks.length > 0 ? this.thinkingBlocks : undefined,
    };
  }
}
