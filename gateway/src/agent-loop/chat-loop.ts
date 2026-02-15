import { ChatCompletionStream } from "openai/lib/ChatCompletionStream";
import { AgentCRUDClient } from "../agent-config-manager";
import { AgentClient, MessageAccumulator } from "../agent_client";
import { MCPManager } from "../tools/mcp/client";
import { AgentRequest, AgentStackFrame, RunAgentInput, Checkpoint, Agent } from "../types";
import { AgentState, createContext, ExecutionContext } from "./states";
import { HilManager } from "../hil/hil-manager";
import { ChatCompletionMessageToolCall } from "openai/resources/index";


class AgentChatLoop {
  private agentshandler: AgentCRUDClient = new AgentCRUDClient();
  private llmclient: AgentClient = new AgentClient();

  private mcpManager?: MCPManager;
  private hilManager?: HilManager;

  //TODO: ASAP implement the full tool executor 
  //1. core tools and core tools manager 
  //2. agent tools executor 
  //3. coordinate everything in a tool executor core+mcp+agentsastool

  private toolExecutor?: ToolExecutor;
  private agentDef?: Agent;

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
          await this.callLLM(input, context);
          break;
        case AgentState.PROCESSING_RESPONSE:
          const message = context.lastMessage;
          if (message?.tool_calls && message.tool_calls.length > 0) {
            const hilManager = new HilManager();
            const needsApproval = hilManager.hillCheck(message);

            if (needsApproval) {
              context.frame.pending_approvals = hilManager.getApprovals();
              this.transitionTo(context, AgentState.AWAITING_APPROVAL);
            } else {
              this.transitionTo(context, AgentState.EXECUTING_TOOLS);
            }
          } else {
            this.transitionTo(context, AgentState.COMPLETED);
          }
          break;
        case AgentState.AWAITING_APPROVAL:
          const hasPendingApprovals = context.frame.pending_approvals?.some(
            approval => approval.approval_status === "pending"
          );

          if (hasPendingApprovals) {
            //NOTE: Here in the future I should emit a particular event checkpoint and exit the loop
            return;
          } else {
            this.transitionTo(context, AgentState.EXECUTING_TOOLS);
          }
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

  private async executeTools(tool_calls: ChatCompletionMessageToolCall[]) {
    //NOTE: Only execute mcp tools for now add agents, core tools to implement yet and Agents as tools.

    for (const call of tool_calls) {
      //NOTE: for now there is a scope issue with the mcp instance where i need to check also here 
      //so maybe i should review all instances and functions parameters in general


    }

  }

}
