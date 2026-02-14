import { Elysia, t } from 'elysia';
import { AgentClient, MessageAccumulator } from './agent_client';
import type { AgentRequest, GatewayAgent } from './types';
import { createManagerWithMCPs, MCPManager } from './mcp/client';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionAssistantMessageParam
} from 'openai/resources/chat/completions';

function isAssistantMessage(message: any): message is ChatCompletionAssistantMessageParam {
  return message.role === 'assistant';
}

const agentClient = new AgentClient('http://localhost:8000');


async function ChatLoop(body: GatewayAgent): Promise<AgentResponse> {
  let mcpManager: MCPManager | null = null;
  let currentState = "INITIALIZING";
  let history: ChatCompletionMessageParam[] = [
    { role: "user", content: body.message }
  ];
  let availableTools: ChatCompletionTool[] = [];
  let iteration = 0;

  if (body.mcps && body.mcps.length > 0) {
    console.log(`📦 Initializing MCPs: ${body.mcps.join(', ')}`);
    mcpManager = await createManagerWithMCPs(body.mcps);
    availableTools = mcpManager.getTools();
    console.log(`🔧 Tools loaded: ${availableTools.length}`);
  }

  currentState = "CALLING";

  while (currentState !== "STOP") {
    iteration++;
    console.log(`\n🔄 [STATE]: ${currentState} (Iteration: ${iteration})`);

    switch (currentState) {
      case "CALLING":
        console.log(`🤖 Requesting LLM completion...`);
        const agentReq: AgentRequest = {
          provider: body.provider,
          system_prompt: body.system_prompt,
          model: body.model,
          history: history,
          tools: availableTools.length > 0 ? availableTools : undefined,
          response_format: body.response_format,
        };

        const accu = new MessageAccumulator();

        for await (const choice of agentClient.chatStream(agentReq)) {
          const currentChoice = choice.choices[0];
          accu.construcMessage(currentChoice.delta)
        }

        const message = accu.buildMessage();
        history.push(message);

        if (isAssistantMessage(message) && message.tool_calls && message.tool_calls.length > 0) {
          console.log(`🛠️  Assistant requested ${message.tool_calls.length} tool(s)`);
          currentState = "EXECUTING_TOOLS";
        } else {
          console.log(`🏁 No tool calls. Ending loop.`);
          finalResponse = message;
          currentState = "END";
        }
        break;

      case "EXECUTING_TOOLS":
        const lastMessage = history[history.length - 1];
        if (isAssistantMessage(lastMessage) && lastMessage.tool_calls) {
          const toolResults = await Promise.all(
            lastMessage.tool_calls.map(async (toolCall) => {
              if (toolCall.type !== "function") throw new Error(`Unsupported tool type: ${toolCall.type}`);

              console.log(`⚙️  Executing: ${toolCall.function.name}...`);

              const result = await mcpManager!.call(
                toolCall.function.name,
                JSON.parse(toolCall.function.arguments)
              );

              console.log(`✅ Result from ${toolCall.function.name} (Length: ${result.length})`);
              return mcpManager!.buildToolResultMessage(toolCall.id, result);
            })
          );

          history.push(...toolResults);
        }
        currentState = "CALLING";
        break;

      case "ERROR":
        console.error("❌ Loop entered error state.");
        currentState = "END";
        break;
    }

    if (iteration > 10) {
      console.warn("⚠️ Max iterations reached. Safety exit.");
      currentState = "END";
    }
  }

  return finalResponse;
}

const app = new Elysia()
  .post('/api/chat', ({ body }) => ChatLoop(body), {
    body: t.Any()
  })
  .listen(3000);


const cleanup = async () => {
  console.log("\n👋 Process exiting, cleaning up...");

  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

console.log(`🦊 Elysia is running at http://localhost:${app.server?.port}`);
