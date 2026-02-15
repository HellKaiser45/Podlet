import { ChatCompletionStream } from "openai/lib/ChatCompletionStream";
import { AgentCRUDClient } from "../agent-config-manager";
import { AgentClient, MessageAccumulator } from "../agent_client";
import { MCPManager } from "../tools/mcp/client";
import { AgentRequest, AgentStackFrame, RunAgentInput, Checkpoint } from "../types";
import { AgentState, createContext, ExecutionContext } from "./states";


class AgentChatLoop {
  private agentshandler: AgentCRUDClient = new AgentCRUDClient();
  private llmclient: AgentClient = new AgentClient();

  async execute(
    input: RunAgentInput,
    frame: AgentStackFrame,
  ) {
    const context = createContext(input, frame)

    while (context.currentState !== AgentState.COMPLETED && context.currentState !== AgentState.FAILED) {

      context.iteration++;
      console.log(`\n🔄 [${input.runId}] State: ${context.currentState} (Iteration: ${context.iteration})`);
      switch (context.currentState) {
        case AgentState.INITIALIZING:
          break;
        case AgentState.CALLING_LLM:
          this.callLLM(input, context);
          break;
        case AgentState.PROCESSING_RESPONSE:
          const message = context.lastMessage;
          if (message?.tool_calls && message.tool_calls.length > 0) {
            //WARN: Implement a proper hil manager
            const Hil = true

          }
          break;
        case AgentState.AWAITING_APPROVAL:
          break;
        case AgentState.EXECUTING_TOOLS:
          break;
      }
    }

  }

  private transitionTo(context: ExecutionContext, newState: AgentState) {
    console.log(`${context.currentState} -> ${newState}`);
    context.currentState = newState;
  }

  private async callLLM(input: RunAgentInput, context: ExecutionContext) {
    const agentdef = await this.agentshandler.loadAgent(input.agentId)
    const accu = new MessageAccumulator();
    const mcp = await MCPManager.create(agentdef.mcps)


    const agentReq: AgentRequest = {
      provider: agentdef.provider,
      system_prompt: agentdef.system_prompt,
      model: agentdef.model,
      tools: mcp.getTools(),
      response_format: agentdef.response_format,
      history: context.frame.history,
    }

    for await (const choice of this.llmclient.chatStream(agentReq)) {
      accu.construcMessage(choice.choices[0].delta)
      let message

      switch (choice.choices[0].finish_reason) {
        case null:
          continue;
        case "tool_calls":
        case "stop":
          message = accu.buildMessage();
          context.frame.history.push(message);
          context.lastMessage = message;
          this.transitionTo(context, AgentState.PROCESSING_RESPONSE);
          return;
        case "content_filter":
        case "length":
          this.transitionTo(context, AgentState.FAILED);
          return;
      }
    }
  }
}
