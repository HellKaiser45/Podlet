import type { ChatCompletionChunk, ChatCompletionMessage, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { AgentRequest, LiteLLMStreamedChunk, ThinkingAnthropic, LiteLLMDelta } from './types';

export class AgentClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async *chatStream(request: AgentRequest): AsyncGenerator<LiteLLMStreamedChunk, void, unknown> {
    const response = await fetch(`${this.baseUrl}/chat/stream`, {
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

  async construcMessage(delta: LiteLLMDelta) {

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


async function runTest() {
  const client = new AgentClient();
  const request = {
    provider: "moonshot",
    model: "kimi-k2.5",
    system_prompt: "You are a helpful assistant. Use tools if needed.",
    history: [{ role: "user", content: "Tell me a joke and then check the weather in Paris." }],
    tools: [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a city",
          parameters: { type: "object", properties: { city: { type: "string" } } }
        }
      }
    ]
  };
  console.log("🚀 Starting Verbose Stream Test...\n");
  const accu = new MessageAccumulator();
  for await (const choice of client.chatStream(request as any)) {
    accu.construcMessage(choice.choices[0].delta);
  }
  console.log(accu.buildMessage());
}

runTest();
