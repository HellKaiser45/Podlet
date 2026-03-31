import type { ChatCompletionChunk, ChatCompletionMessage, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { AgentRequest, LiteLLMStreamedChunk, ThinkingAnthropic, LiteLLMDelta, LiteLLMMessage } from './types';
import AppContainer from './runtime';
import { CoreToolsManager } from './tools/core/core_tools';
import { TextMessageStartEvent, EventType, TextMessageChunkEvent } from '@ag-ui/core';
import { randomUUIDv7 } from 'bun';


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

    const cleanedTools = tools.map((tool: any) => {
      if (tool?.type === "function" && tool.function) {
        return {
          ...tool,
          function: {
            ...tool.function,
            strict: false         // ← Force strict: true for all tools
          }
        };
      }
      return tool; // pass through non-function tools unchanged
    });


    const systemPrompt = await this.appContainer.skillManager.injectSkills(agent.skills || [], await this.appContainer.agentManager.getAgentprompt(agentId));

    return {
      provider: model.provider,
      model: model.model,
      system_prompt: systemPrompt,
      history: history,
      tools: cleanedTools,
      response_format: agent.response_format,
    }
  }

  async *chatStream(agentId: string, history: LiteLLMMessage[]): AsyncGenerator<LiteLLMStreamedChunk, void, unknown> {

    const request = await this.buildRequest(agentId, history)
    const baseUrl = this.appContainer.initConfig.llmApiUrl.replace(/\/$/, '');
    const url = `${baseUrl}${this.streamEndpoint}`;

    const start = new Date();
    console.log(start.toLocaleString(), " start calling for chunks")
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
