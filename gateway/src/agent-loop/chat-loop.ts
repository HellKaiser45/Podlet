import { AgentCRUDClient } from "../agent-config-manager";
import { AgentClient, MessageAccumulator } from "../agent_client";
import { MCPManager } from "../tools/mcp/client";
import { AgentRequest, AgentStackFrame, RunAgentInput } from "../types";
import { AgentState, createContext, ExecutionContext } from "./states";


class AgentChatLoop {
  private agentshandler: AgentCRUDClient = new AgentCRUDClient();
  private mcphandler: MCPManager = new MCPManager();
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
          break;
        case AgentState.PROCESSING_RESPONSE:
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

  private async callLLM(input: RunAgentInput) {
    const agentdef = await this.agentshandler.loadAgent(input.agentId)
    const accu = new MessageAccumulator();
    const mcp = await this.mcphandler.getTools(agentdef.mcps)
    const agentReq: AgentRequest = {
      provider: agentdef.provider,
      system_prompt: agentdef.system_prompt,
      model: agentdef.model,
    }

  }
}
