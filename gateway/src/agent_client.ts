import type { ChatCompletionChunk, ChatCompletionMessage, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { AgentRequest, LiteLLMStreamedChunk, ThinkingAnthropic, LiteLLMDelta, LiteLLMMessage } from './types';
import AppContainer from './runtime';
import { CoreToolsManager } from './tools/core/core_tools';


export class AgentClient {
  private readonly streamEndpoint = '/chat/stream'
  private readonly appContainer: AppContainer

  constructor(appcontainer: AppContainer) {
    this.appContainer = appcontainer;
  }

  private async buildRequest(agentId: string, history: LiteLLMMessage[]): Promise<AgentRequest> {
    const agent = this.appContainer.agentManager.agents[agentId];
    const model = this.appContainer.modelManager.models[agent.model];

    const coreTools = new CoreToolsManager

    const tools = [
      ...this.appContainer.mcpManager.getTools(agent.mcps || []),
      ...coreTools.getToolDefinitions(),
      ...await this.appContainer.agentToolsManager.getAgentAsToolDefinition(agent.subAgents || []),
    ];

    const systemPrompt = await this.appContainer.skillManager.injectSkills(agent.skills || [], await this.appContainer.agentManager.getAgentprompt(agentId));

    return {
      provider: model.provider,
      model: model.model,
      system_prompt: systemPrompt,
      history: history,
      tools: tools,
      response_format: agent.response_format,
    }

  }

  async *chatStream(agentId: string, history: LiteLLMMessage[]): AsyncGenerator<LiteLLMStreamedChunk, void, unknown> {

    const request = await this.buildRequest(agentId, history)
    const baseUrl = this.appContainer.initConfig.llmApiUrl.replace(/\/$/, '');
    const url = `${baseUrl}${this.streamEndpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Agent Server Error ${response.status}: ${errorText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          const chunk: LiteLLMStreamedChunk = JSON.parse(data);
          yield chunk;
        }
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
        }
        else {
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

  buildMessage(): ChatCompletionMessage & {
    reasoning_content?: string;
    thinking_blocks?: ThinkingAnthropic[];
  } {
    const toolCallsArray = Object.entries(this.toolCalls)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([, tc]) => tc as ChatCompletionMessageToolCall);

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
