import type { ChatCompletionChunk, ChatCompletionMessage, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { ModelMessage, ToolSet } from 'ai';
import type { AgentThinking, LiteLLMStreamedChunk, ThinkingAnthropic, LiteLLMDelta, LiteLLMMessage, Protocol } from './types';
import AppContainer from './runtime';
import { getCoreToolDefinitions } from './tools/core/core_tools';
import { VirtualFileSystem } from './system/sandbox';
import { hydrateVisionHistory } from './system/vision-hydrate';
import { thinkingQuirkConflict, type ResolvedModel } from './system/providers';
import { buildLanguageModel } from './llm/provide';
import { buildProviderOptions } from './llm/thinking';
import { toModelMessages, toToolSet } from './llm/messages';
import { runLlmStream } from './llm/stream';

/** A fully-resolved in-process LLM request (no HTTP transport). */
type ResolvedRequest = {
  agentId: string;
  /** The model's `provider` name, used to pick the SDK factory. */
  providerName: string;
  protocol: Protocol;
  modelId: string;
  resolved: ResolvedModel;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  temperature?: number;
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

    const cleanedTools = gatedTools.map((tool: any) => {
      if (tool?.type === "function" && tool.function) {
        return { ...tool, function: { ...tool.function, strict: false } };
      }
      return tool;
    });

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

    return {
      agentId,
      providerName: model.provider,
      protocol: resolved.protocol,
      modelId: model.model,
      resolved,
      temperature: model.temperature ?? undefined,
      system: systemPrompt + `\n\n` + updatedSystemPrompt,
      messages: toModelMessages(hydrated),
      tools: cleanedTools.length > 0 ? toToolSet(cleanedTools) : undefined,
      thinking,
      responseFormat: agent.response_format,
    };
  }

  async *chatStream(agentId: string, history: LiteLLMMessage[], vfileSystem: VirtualFileSystem): AsyncGenerator<LiteLLMStreamedChunk, void, unknown> {
    const request = await this.buildRequest(agentId, history, vfileSystem);

    const providerOptions = buildProviderOptions(request.protocol, request.thinking, request.resolved.quirks);
    this.applyResponseFormat(request, providerOptions);

    const languageModel = buildLanguageModel(request.providerName, request.resolved, request.modelId);

    yield* runLlmStream({
      model: languageModel,
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      // `none` thinking produces an empty block -> send nothing at all.
      providerOptions: Object.keys(providerOptions).length > 0
        ? providerOptions
        : undefined,
      temperature: request.temperature,
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
