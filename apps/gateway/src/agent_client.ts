import type { ChatCompletionChunk, ChatCompletionMessage, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { AgentRequest, LiteLLMStreamedChunk, ThinkingAnthropic, LiteLLMDelta, LiteLLMMessage } from './types';
import { TokenLimitError } from './types';
import AppContainer from './runtime';
import { CoreToolsManager } from './tools/core/core_tools';
import { VirtualFileSystem } from './system/sandbox';

export class AgentClient {
  private readonly streamEndpoint = '/chat/stream'
  private readonly appContainer: AppContainer

  constructor(appcontainer: AppContainer) {
    this.appContainer = appcontainer;
  }

  /** Rough token estimation: chars / 4 */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Estimate tokens for a single message, handling multimodal content */
  private estimateMessageTokens(msg: LiteLLMMessage): number {
    if (typeof msg.content === 'string') {
      return this.estimateTokens(msg.content);
    }
    if (Array.isArray(msg.content)) {
      return (msg.content as any[]).reduce((sum: number, part: any) => {
        if (part.type === 'text' && part.text) return sum + this.estimateTokens(part.text);
        if (part.type === 'image_url' && part.image_url?.url) {
          // Base64 images are very large in the string; rough estimate
          return sum + Math.max(1000, Math.ceil(part.image_url.url.length / 100));
        }
        return sum;
      }, 0);
    }
    return 0;
  }

  private async buildRequest(agentId: string, history: LiteLLMMessage[], vfileSystem: VirtualFileSystem): Promise<AgentRequest> {
    const agent = this.appContainer.agentManager.agents[agentId];
    const model = this.appContainer.modelManager.models[agent.model];
    const coreTools = new CoreToolsManager();
    const tools = [
      ...this.appContainer.mcpManager.getTools(agent.mcps || []),
      ...coreTools.getToolDefinitions(),
      ...await this.appContainer.agentToolsManager.getAgentAsToolDefinition(agent.subAgents || []),
    ];

    const cleanedTools = tools.map((tool: any) => {
      if (tool?.type === "function" && tool.function) {
        return { ...tool, function: { ...tool.function, strict: false } };
      }
      return tool;
    });

    const systemPrompt = await this.appContainer.skillManager.injectSkills(agent.skills || [], await this.appContainer.agentManager.getAgentprompt(agentId), vfileSystem);
    const updatedSystemPrompt = await vfileSystem.getContextTree()
    const fullSystemPrompt = systemPrompt + '\n\n' + updatedSystemPrompt;

    // --- Token budget check ---
    const contextWindow = model.context_window ?? 128000;
    const safetyMargin = Math.floor(contextWindow * 0.1);
    const maxTokens = contextWindow - safetyMargin;

    let totalEstimatedTokens = 0;
    totalEstimatedTokens += this.estimateTokens(fullSystemPrompt);
    for (const msg of history) {
      totalEstimatedTokens += this.estimateMessageTokens(msg);
    }

    if (totalEstimatedTokens > maxTokens) {
      throw new TokenLimitError(
        `Token budget exceeded: estimated ${totalEstimatedTokens} tokens exceeds model limit of ${maxTokens} (context window: ${contextWindow}). History: ${history.length} messages. Consider starting a new conversation.`,
        'TOKEN_LIMIT_EXCEEDED'
      );
    }

    return {
      provider: model.provider,
      model: model.model,
      configpath: this.appContainer.initConfig.podeletDir,
      api_key_name: model.api_key_name,
      temperature: model.temperature ?? undefined,
      max_tokens: model.max_tokens ?? undefined,
      base_url: model.base_url ?? undefined,
      system_prompt: fullSystemPrompt,
      history: history as AgentRequest['history'],
      tools: cleanedTools.length > 0 ? cleanedTools : undefined,
      response_format: agent.response_format,
    }
  }

  async *chatStream(agentId: string, history: LiteLLMMessage[], vfileSystem: VirtualFileSystem): AsyncGenerator<LiteLLMStreamedChunk, void, unknown> {
    const request = await this.buildRequest(agentId, history, vfileSystem)
    const baseUrl = this.appContainer.initConfig.llmApiUrl.replace(/\/$/, '');
    const url = `${baseUrl}${this.streamEndpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Agent Server Error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error(`Agent Server Error ${response.status}: No body`);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk);
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        const jsonEvent: LiteLLMStreamedChunk = JSON.parse(data);
        yield jsonEvent;
      }
    }
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
